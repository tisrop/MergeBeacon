use crate::models::IssueTemplate;
// TODO(security): Replace deprecated serde_yaml with a maintained parser after validating
// compatibility with the Issue Form and Markdown frontmatter syntax supported here.
use serde_yaml::{Mapping, Value};

pub const MAX_ISSUE_TEMPLATE_FILES: usize = 30;
pub const MAX_ISSUE_TEMPLATE_BYTES: usize = 256 * 1024;

pub fn is_supported_template_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    (lower.ends_with(".md") || lower.ends_with(".yaml") || lower.ends_with(".yml"))
        && !lower.ends_with("/config.yml")
        && !lower.ends_with("/config.yaml")
}

pub fn parse_template(path: &str, content: &str) -> Option<IssueTemplate> {
    if content.len() > MAX_ISSUE_TEMPLATE_BYTES || !is_supported_template_path(path) {
        return None;
    }
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".yaml") || lower.ends_with(".yml") {
        parse_issue_form(path, content)
    } else {
        Some(parse_markdown_template(path, content))
    }
}

pub async fn parse_remote_template(path: &str, content: &str) -> Option<IssueTemplate> {
    if content.len() > MAX_ISSUE_TEMPLATE_BYTES || !is_supported_template_path(path) {
        return None;
    }

    let path = path.to_string();
    let content = content.to_string();
    tokio::task::spawn_blocking(move || parse_template(&path, &content)).await.ok().flatten()
}

fn parse_markdown_template(path: &str, content: &str) -> IssueTemplate {
    let normalized = content.replace("\r\n", "\n");
    let (metadata, body) = split_frontmatter(&normalized);
    let mapping = metadata.and_then(|value| serde_yaml::from_str::<Value>(value).ok()).and_then(|value| match value {
        Value::Mapping(mapping) => Some(mapping),
        _ => None,
    });

    IssueTemplate {
        name: mapping
            .as_ref()
            .and_then(|value| mapping_string(value, "name"))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| filename_label(path)),
        description: mapping
            .as_ref()
            .and_then(|value| mapping_string(value, "about"))
            .filter(|value| !value.is_empty()),
        title: mapping.as_ref().and_then(|value| mapping_raw_string(value, "title")).unwrap_or_default(),
        labels: mapping.as_ref().map(|value| mapping_labels(value, "labels")).unwrap_or_default(),
        body: body.trim_matches('\n').to_string(),
        source_path: path.to_string(),
    }
}

fn parse_issue_form(path: &str, content: &str) -> Option<IssueTemplate> {
    let Value::Mapping(root) = serde_yaml::from_str::<Value>(content).ok()? else {
        return None;
    };
    let name =
        mapping_string(&root, "name").filter(|value| !value.trim().is_empty()).unwrap_or_else(|| filename_label(path));
    let description = mapping_string(&root, "description").filter(|value| !value.is_empty());
    let title = mapping_raw_string(&root, "title").unwrap_or_default();
    let labels = mapping_labels(&root, "labels");
    let body = root
        .get(Value::String("body".into()))
        .and_then(Value::as_sequence)
        .map(|blocks| blocks.iter().filter_map(render_form_block).collect::<Vec<_>>().join("\n\n"))
        .unwrap_or_default();

    Some(IssueTemplate { name, description, title, body, labels, source_path: path.to_string() })
}

fn render_form_block(value: &Value) -> Option<String> {
    let mapping = value.as_mapping()?;
    let block_type = mapping_string(mapping, "type")?;
    let attributes = mapping.get(Value::String("attributes".into())).and_then(Value::as_mapping);
    match block_type.as_str() {
        "markdown" => attributes.and_then(|items| mapping_string(items, "value")).filter(|value| !value.is_empty()),
        "input" | "textarea" => {
            let attributes = attributes?;
            let label = mapping_string(attributes, "label").unwrap_or_else(|| "补充信息".into());
            let description = mapping_string(attributes, "description").unwrap_or_default();
            let value = mapping_string(attributes, "value").unwrap_or_default();
            let placeholder = mapping_string(attributes, "placeholder").unwrap_or_default();
            let mut output = format!("### {label}");
            if !description.is_empty() {
                output.push_str(&format!("\n\n{description}"));
            }
            if !value.is_empty() {
                output.push_str(&format!("\n\n{value}"));
            } else if !placeholder.is_empty() {
                output.push_str(&format!("\n\n<!-- {placeholder} -->"));
            }
            Some(output)
        }
        "dropdown" => {
            let attributes = attributes?;
            let label = mapping_string(attributes, "label").unwrap_or_else(|| "请选择".into());
            let options = mapping_strings(attributes, "options");
            let mut output = format!("### {label}");
            for option in options {
                output.push_str(&format!("\n- [ ] {option}"));
            }
            Some(output)
        }
        "checkboxes" => {
            let attributes = attributes?;
            let label = mapping_string(attributes, "label").unwrap_or_else(|| "检查项".into());
            let mut output = format!("### {label}");
            if let Some(options) = attributes.get(Value::String("options".into())).and_then(Value::as_sequence) {
                for option in options {
                    let text = option
                        .as_mapping()
                        .and_then(|item| mapping_string(item, "label"))
                        .or_else(|| option.as_str().map(str::to_string));
                    if let Some(text) = text {
                        output.push_str(&format!("\n- [ ] {text}"));
                    }
                }
            }
            Some(output)
        }
        _ => None,
    }
}

fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (None, content);
    };
    if let Some(end) = rest.find("\n---\n") {
        return (Some(&rest[..end]), &rest[end + 5..]);
    }
    if let Some(metadata) = rest.strip_suffix("\n---") {
        return (Some(metadata), "");
    }
    (None, content)
}

fn mapping_string(mapping: &Mapping, key: &str) -> Option<String> {
    mapping.get(Value::String(key.into())).and_then(|value| match value {
        Value::String(value) => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    })
}

fn mapping_raw_string(mapping: &Mapping, key: &str) -> Option<String> {
    mapping.get(Value::String(key.into())).and_then(|value| value.as_str().map(str::to_string))
}

fn mapping_strings(mapping: &Mapping, key: &str) -> Vec<String> {
    let Some(value) = mapping.get(Value::String(key.into())) else {
        return Vec::new();
    };
    match value {
        Value::Sequence(values) => values
            .iter()
            .filter_map(|value| value.as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string))
            .collect(),
        Value::String(value) => {
            value.split(',').map(str::trim).filter(|value| !value.is_empty()).map(str::to_string).collect()
        }
        _ => Vec::new(),
    }
}

fn mapping_labels(mapping: &Mapping, key: &str) -> Vec<String> {
    mapping_strings(mapping, key)
}

fn filename_label(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(path)
        .replace(['-', '_'], " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_markdown_frontmatter_and_crlf() {
        let template = parse_template(
            ".github/ISSUE_TEMPLATE/bug.md",
            "---\r\nname: Bug 报告\r\nabout: 描述一个缺陷\r\ntitle: '[Bug] '\r\nlabels: bug, triage\r\n---\r\n## 复现步骤\r\n",
        )
        .expect("template");
        assert_eq!(template.name, "Bug 报告");
        assert_eq!(template.description.as_deref(), Some("描述一个缺陷"));
        assert_eq!(template.title, "[Bug] ");
        assert_eq!(template.labels, vec!["bug", "triage"]);
        assert_eq!(template.body, "## 复现步骤");
    }

    #[test]
    fn parses_markdown_frontmatter_closed_at_end_of_file() {
        let template =
            parse_template(".github/ISSUE_TEMPLATE/metadata-only.md", "---\nname: 仅元数据模板\nlabels: triage\n---")
                .expect("template");

        assert_eq!(template.name, "仅元数据模板");
        assert_eq!(template.labels, vec!["triage"]);
        assert!(template.body.is_empty());
    }

    #[test]
    fn converts_issue_form_to_editable_markdown() {
        let template = parse_template(
            ".github/ISSUE_TEMPLATE/feature.yml",
            r#"name: 功能建议
description: 提交新功能建议
title: "[Feature] "
labels:
  - enhancement
body:
  - type: markdown
    attributes:
      value: 请完整填写以下信息
  - type: textarea
    attributes:
      label: 使用场景
      placeholder: 描述你遇到的问题
  - type: dropdown
    attributes:
      label: 优先级
      options: [高, 中, 低]
  - type: checkboxes
    attributes:
      label: 确认项
      options:
        - label: 我已搜索现有 Issue
"#,
        )
        .expect("template");
        assert_eq!(template.labels, vec!["enhancement"]);
        assert!(template.body.contains("### 使用场景"));
        assert!(template.body.contains("<!-- 描述你遇到的问题 -->"));
        assert!(template.body.contains("- [ ] 高"));
        assert!(template.body.contains("- [ ] 我已搜索现有 Issue"));
    }

    #[test]
    fn ignores_config_and_oversized_templates() {
        assert!(parse_template(".github/ISSUE_TEMPLATE/config.yml", "blank_issues_enabled: true").is_none());
        assert!(parse_template("bug.md", &"x".repeat(MAX_ISSUE_TEMPLATE_BYTES + 1)).is_none());
    }

    #[tokio::test]
    async fn remote_parser_skips_malformed_yaml_without_error() {
        assert!(parse_remote_template(".github/ISSUE_TEMPLATE/bad.yml", "name: [unterminated").await.is_none());
    }

    #[tokio::test]
    async fn remote_parser_rejects_oversized_input() {
        let oversized = "x".repeat(MAX_ISSUE_TEMPLATE_BYTES + 1);
        assert!(parse_remote_template(".github/ISSUE_TEMPLATE/large.yml", &oversized).await.is_none());
    }

    #[tokio::test]
    async fn remote_parser_returns_valid_template() {
        let template = parse_remote_template(
            ".github/ISSUE_TEMPLATE/bug.yml",
            "name: Bug 报告\ndescription: 描述缺陷\nlabels: [bug]\nbody: []\n",
        )
        .await
        .expect("template");

        assert_eq!(template.name, "Bug 报告");
        assert_eq!(template.labels, vec!["bug"]);
    }
}
