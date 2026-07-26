use crate::models::PrTemplate;
use std::collections::HashSet;

pub const MAX_PR_TEMPLATE_FILES: usize = 30;
pub const MAX_PR_TEMPLATE_BYTES: usize = 256 * 1024;

pub fn is_supported_template_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

pub fn deduplicate_template_paths(paths: &mut Vec<String>) {
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.to_ascii_lowercase()));
}

pub async fn parse_remote_template(path: &str, content: &str) -> Option<PrTemplate> {
    if content.len() > MAX_PR_TEMPLATE_BYTES || !is_supported_template_path(path) {
        return None;
    }

    let issue_template = crate::issue_template::parse_remote_template(path, content).await?;
    Some(PrTemplate {
        name: issue_template.name,
        title: issue_template.title,
        body: issue_template.body,
        source_path: issue_template.source_path,
    })
}

#[cfg(test)]
mod tests {
    use super::{deduplicate_template_paths, parse_remote_template, MAX_PR_TEMPLATE_BYTES};

    #[test]
    fn deduplicates_paths_case_insensitively_and_preserves_first_spelling() {
        let mut paths = vec![
            ".github/PULL_REQUEST_TEMPLATE/feature.md".to_string(),
            ".github/PULL_REQUEST_TEMPLATE/FEATURE.md".to_string(),
            ".github/PULL_REQUEST_TEMPLATE/bug.md".to_string(),
        ];

        deduplicate_template_paths(&mut paths);

        assert_eq!(paths, vec![".github/PULL_REQUEST_TEMPLATE/feature.md", ".github/PULL_REQUEST_TEMPLATE/bug.md",]);
    }

    #[tokio::test]
    async fn parses_markdown_template_frontmatter() {
        let template = parse_remote_template(
            ".github/PULL_REQUEST_TEMPLATE/feature.md",
            "---\nname: 功能变更\ntitle: 'feat: '\n---\n## 变更说明\n",
        )
        .await
        .expect("template");

        assert_eq!(template.name, "功能变更");
        assert_eq!(template.title, "feat: ");
        assert_eq!(template.body, "## 变更说明");
    }

    #[tokio::test]
    async fn rejects_non_markdown_and_oversized_templates() {
        assert!(parse_remote_template("template.yml", "name: no").await.is_none());
        assert!(parse_remote_template("template.md", &"a".repeat(MAX_PR_TEMPLATE_BYTES + 1)).await.is_none());
    }
}
