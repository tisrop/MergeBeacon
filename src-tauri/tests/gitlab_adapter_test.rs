use mergebeacon_lib::error::AppError;
use mergebeacon_lib::http_client::HttpClient;
use mergebeacon_lib::models::{
    Issue, IssueMetadataPermissions, IssueMetadataUpdate, IssueState, MergeQueueState, PrCommitTruncatedEnd,
    PrCreatePreviewRequest, PrCreateRequest, PrDetail, PrListQuery, PrListSort, PrMetadataField, PrMetadataPermissions,
    PrMetadataUpdate, PrMilestone, PrReviewFilter, PrReviewStatus, PrState, PrSummary, ReadinessState, ReviewEvent,
    ReviewInboxCategory, ReviewInboxRelationship, User,
};
use mergebeacon_lib::platform::{gitlab::GitLabAdapter, GitPlatform};
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn test_gitlab_get_issue_detail_encodes_nested_project_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/issues/7"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 7,
            "title": "Broken deploy",
            "description": "Pipeline fails on release jobs",
            "state": "opened",
            "author": { "id": 1, "username": "reporter", "name": "Reporter", "avatar_url": "" },
            "labels": ["bug", "release"],
            "created_at": "2025-01-05T00:00:00Z",
            "updated_at": "2025-01-06T00:00:00Z"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 1,
            "username": "reporter"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "permissions": {
                "project_access": { "access_level": 20 },
                "group_access": null
            }
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let issue = adapter.get_issue("group/sub", "repo", 7).await.expect("should get issue");

    assert_eq!(issue.number, 7);
    assert_eq!(issue.body, "Pipeline fails on release jobs");
    assert_eq!(issue.labels, vec!["bug".to_string(), "release".to_string()]);
    assert!(matches!(issue.state, mergebeacon_lib::models::IssueState::Open));
    assert!(!issue.is_pull_request);
    assert_eq!(issue.metadata_permissions.can_edit_title_body, Some(true));
    assert_eq!(issue.metadata_permissions.can_change_state, Some(true));
    assert_eq!(issue.metadata_permissions.can_manage_labels, Some(false));
}

#[tokio::test]
async fn test_gitlab_updates_issue_metadata_and_filters_system_notes() {
    let mock_server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/issues/7"))
        .and(body_json(serde_json::json!({
            "title": "Fixed deploy",
            "description": "Updated description",
            "labels": "bug,release",
            "state_event": "close"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 7,
            "title": "Fixed deploy",
            "description": "Updated description",
            "state": "closed",
            "author": { "id": 1, "username": "reporter", "name": "Reporter", "avatar_url": "" },
            "labels": ["bug", "release"],
            "created_at": "2025-01-05T00:00:00Z",
            "updated_at": "2025-01-07T00:00:00Z"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/issues/7"))
        .and(body_json(serde_json::json!({ "title": "Title only" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 7,
            "title": "Title only",
            "description": "Old description",
            "state": "opened",
            "author": { "id": 1, "username": "reporter", "name": "Reporter", "avatar_url": "" },
            "labels": ["bug"],
            "created_at": "2025-01-05T00:00:00Z",
            "updated_at": "2025-01-07T01:00:00Z"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/issues/7/notes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {
                "id": 10,
                "body": "changed title",
                "system": true,
                "author": { "id": 1, "username": "system", "name": "", "avatar_url": "" },
                "created_at": "2025-01-06T00:00:00Z",
                "updated_at": "2025-01-06T00:00:00Z"
            },
            {
                "id": 11,
                "body": "Please verify",
                "system": false,
                "author": { "id": 2, "username": "reviewer", "name": "", "avatar_url": "" },
                "created_at": "2025-01-06T01:00:00Z",
                "updated_at": "2025-01-06T01:00:00Z"
            }
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/issues/7/notes"))
        .and(body_json(serde_json::json!({ "body": "Verified" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "id": 12,
            "body": "Verified",
            "author": { "id": 3, "username": "author", "name": "", "avatar_url": "" },
            "created_at": "2025-01-07T01:00:00Z",
            "updated_at": "2025-01-07T01:00:00Z"
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let current = Issue {
        number: 7,
        title: "Broken deploy".into(),
        body: "Old description".into(),
        author: User {
            id: serde_json::json!(1),
            login: "reporter".into(),
            name: String::new(),
            avatar_url: String::new(),
        },
        state: IssueState::Open,
        labels: vec!["bug".into()],
        label_colors: Default::default(),
        created_at: "2025-01-05T00:00:00Z".into(),
        updated_at: "2025-01-06T00:00:00Z".into(),
        is_pull_request: false,
        metadata_permissions: IssueMetadataPermissions::default(),
    };
    let update = IssueMetadataUpdate {
        title: "Fixed deploy".into(),
        body: "Updated description".into(),
        state: IssueState::Closed,
        labels: vec!["bug".into(), "release".into()],
        expected_updated_at: current.updated_at.clone(),
    };

    let updated =
        adapter.update_issue_metadata("group/sub", "repo", 7, &current, &update).await.expect("should update issue");
    let title_only_update = IssueMetadataUpdate {
        title: "Title only".into(),
        body: current.body.clone(),
        state: current.state.clone(),
        labels: current.labels.clone(),
        expected_updated_at: current.updated_at.clone(),
    };
    let title_only = adapter
        .update_issue_metadata("group/sub", "repo", 7, &current, &title_only_update)
        .await
        .expect("should update only the title");
    let comments = adapter.list_issue_comments("group/sub", "repo", 7).await.expect("should list comments");
    let created =
        adapter.create_issue_comment("group/sub", "repo", 7, "Verified").await.expect("should create comment");

    assert!(matches!(updated.state, IssueState::Closed));
    assert_eq!(title_only.title, "Title only");
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].body, "Please verify");
    assert_eq!(created.author.login, "author");
}

#[tokio::test]
async fn test_gitlab_lists_branches_and_creates_draft_from_fork() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/branches"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "name": "main" },
            { "name": "feature" }
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 77,
            "default_branch": "feature"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/contributor%2Frepo/merge_requests"))
        .and(body_json(serde_json::json!({
            "source_branch": "feature",
            "target_branch": "main",
            "title": "Draft: Add feature",
            "description": "Description",
            "target_project_id": 77
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({ "iid": 12 })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/contributor%2Frepo/repository/compare"))
        .and(query_param("from", "main"))
        .and(query_param("to", "feature"))
        .and(query_param("straight", "true"))
        .and(query_param("from_project_id", "77"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "compare_timeout": false,
            "compare_same_ref": false,
            "commits": [{
                "id": "abc123",
                "title": "Add feature",
                "author_name": "Alice",
                "authored_date": "2026-07-19T10:00:00Z"
            }],
            "diffs": [{
                "old_path": "src/main.rs",
                "new_path": "src/main.rs",
                "diff": "@@ -1 +1 @@\n-old\n+new",
                "new_file": false,
                "deleted_file": false,
                "renamed_file": false
            }]
        })))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let branch_options = adapter.list_branches("group", "repo").await.unwrap();
    assert_eq!(branch_options.branches, vec!["main", "feature"]);
    assert_eq!(branch_options.default_branch.as_deref(), Some("feature"));
    let preview = adapter
        .preview_pull_request(
            "group",
            "repo",
            &PrCreatePreviewRequest {
                source_owner: "contributor".into(),
                source_repo: "repo".into(),
                source_branch: "feature".into(),
                target_branch: "main".into(),
                commit_sha: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(preview.commits[0].title, "Add feature");
    assert_eq!(preview.files[0].filename, "src/main.rs");
    assert!(!preview.incomplete);
    let number = adapter
        .create_pull_request(
            "group",
            "repo",
            &PrCreateRequest {
                source_owner: "contributor".into(),
                source_repo: "repo".into(),
                source_branch: "feature".into(),
                target_branch: "main".into(),
                title: "Add feature".into(),
                body: "Description".into(),
                draft: true,
                reviewers: vec![],
                assignees: vec![],
                labels: vec![],
            },
        )
        .await
        .unwrap();
    assert_eq!(number, 12);
}

#[tokio::test]
async fn test_gitlab_lists_pr_dependency_candidates() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 12,
            "title": "Stack child",
            "state": "opened",
            "merged_at": null,
            "source_branch": "feature-b",
            "target_branch": "feature-a",
            "source_project_id": 77,
            "target_project_id": 77
        })))
        .mount(&mock_server)
        .await;
    for (filter, value) in [("target_branch", "feature-b"), ("source_branch", "feature-a")] {
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests"))
            .and(query_param("state", "all"))
            .and(query_param(filter, value))
            .and(query_param("per_page", "100"))
            .and(query_param("page", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&mock_server)
            .await;
    }
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let result =
        adapter.list_pr_dependency_candidates("group/subgroup", "repo", 12).await.expect("dependency candidates");

    assert!(!result.truncated);
    assert_eq!(result.current.number, 12);
    let candidates = result.items;
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].number, 12);
    assert_eq!(candidates[0].source_repository, "gitlab-project:77");
    assert_eq!(candidates[0].target_repository, "gitlab-project:77");
}

#[tokio::test]
async fn test_gitlab_reads_merge_train_position_and_failed_pipeline() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 12,
            "target_branch": "main",
            "sha": "mr-head-sha"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_trains/main"))
        .and(query_param("scope", "active"))
        .and(query_param("sort", "asc"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-total", "2").set_body_json(serde_json::json!([
            {
                "id": 100,
                "status": "idle",
                "target_branch": "main",
                "merge_request": { "iid": 11 },
                "pipeline": null,
                "created_at": "2026-07-21T00:00:00Z",
                "updated_at": "2026-07-21T00:01:00Z"
            },
            {
                "id": 101,
                "status": "fresh",
                "target_branch": "main",
                "merge_request": { "iid": 12 },
                "pipeline": { "status": "failed", "sha": "train-sha" },
                "created_at": "2026-07-21T00:02:00Z",
                "updated_at": "2026-07-21T00:03:00Z"
            }
        ])))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let status = adapter.get_pr_merge_queue_status("group/subgroup", "repo", 12).await.unwrap();

    assert!(status.available);
    assert_eq!(status.state, MergeQueueState::Failed);
    assert_eq!(status.position, Some(2));
    assert_eq!(status.total, Some(2));
    assert_eq!(status.pipeline_status.as_deref(), Some("failed"));
    assert_eq!(status.head_sha.as_deref(), Some("train-sha"));
    assert_eq!(status.failure_reason.as_deref(), Some("Merge Train Pipeline 状态为 failed"));
}

#[tokio::test]
async fn test_gitlab_reports_unavailable_merge_train_api() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 12,
            "target_branch": "main",
            "sha": "mr-head-sha"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let status = adapter.get_pr_merge_queue_status("group", "repo", 12).await.unwrap();

    assert!(!status.available);
    assert_eq!(status.state, MergeQueueState::Unknown);
    assert_eq!(status.target_branch.as_deref(), Some("main"));
    assert!(status.failure_reason.as_deref().unwrap_or_default().contains("许可证"));
}

#[tokio::test]
async fn test_gitlab_reports_mr_not_in_merge_train() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 12,
            "target_branch": "main",
            "sha": "mr-head-sha"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/merge_requests/12"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let status = adapter.get_pr_merge_queue_status("group", "repo", 12).await.unwrap();

    assert!(status.available);
    assert_eq!(status.state, MergeQueueState::NotQueued);
    assert_eq!(status.target_branch.as_deref(), Some("main"));
    assert_eq!(status.head_sha.as_deref(), Some("mr-head-sha"));
}

#[tokio::test]
async fn test_gitlab_does_not_fetch_an_extra_page_when_total_is_exactly_page_size() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/999"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 999,
            "target_branch": "main",
            "sha": "mr-head-sha"
        })))
        .mount(&mock_server)
        .await;
    let entries = (1..=100)
        .map(|iid| {
            serde_json::json!({
                "id": iid,
                "status": "idle",
                "target_branch": "main",
                "merge_request": { "iid": iid },
                "pipeline": null
            })
        })
        .collect::<Vec<_>>();
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .and(query_param("scope", "active"))
        .and(query_param("sort", "asc"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-total", "100").set_body_json(entries))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/merge_requests/999"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let status = adapter.get_pr_merge_queue_status("group", "repo", 999).await.unwrap();

    assert!(status.available);
    assert_eq!(status.state, MergeQueueState::NotQueued);
}

#[tokio::test]
async fn test_gitlab_reads_merge_train_position_across_pages() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/101"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 101,
            "target_branch": "main",
            "sha": "mr-head-sha"
        })))
        .mount(&mock_server)
        .await;
    let first_page = (1..=100)
        .map(|iid| {
            serde_json::json!({
                "id": iid,
                "status": "idle",
                "target_branch": "main",
                "merge_request": { "iid": iid },
                "pipeline": null
            })
        })
        .collect::<Vec<_>>();
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .and(query_param("scope", "active"))
        .and(query_param("sort", "asc"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "2")
                .insert_header("x-total-pages", "2")
                .insert_header("x-total", "101")
                .set_body_json(first_page),
        )
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_trains/main"))
        .and(query_param("scope", "active"))
        .and(query_param("sort", "asc"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "")
                .insert_header("x-total-pages", "2")
                .insert_header("x-total", "101")
                .set_body_json(serde_json::json!([{
                    "id": 101,
                    "status": "fresh",
                    "target_branch": "main",
                    "merge_request": { "iid": 101 },
                    "pipeline": { "status": "running", "sha": "train-sha" },
                    "created_at": "2026-07-21T00:00:00Z",
                    "updated_at": "2026-07-21T00:01:00Z"
                }])),
        )
        .expect(1)
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let status = adapter.get_pr_merge_queue_status("group", "repo", 101).await.unwrap();

    assert!(status.available);
    assert_eq!(status.state, MergeQueueState::Waiting);
    assert_eq!(status.position, Some(101));
    assert_eq!(status.total, Some(101));
    assert_eq!(status.head_sha.as_deref(), Some("train-sha"));
}

#[tokio::test]
async fn test_gitlab_create_compare_marks_a_timed_out_preview_incomplete() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/compare"))
        .and(query_param("from", "main"))
        .and(query_param("to", "feature"))
        .and(query_param("straight", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "compare_timeout": true,
            "compare_same_ref": false,
            "commits": [],
            "diffs": []
        })))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let preview = adapter
        .preview_pull_request(
            "group",
            "repo",
            &PrCreatePreviewRequest {
                source_owner: "group".into(),
                source_repo: "repo".into(),
                source_branch: "feature".into(),
                target_branch: "main".into(),
                commit_sha: None,
            },
        )
        .await
        .unwrap();

    assert!(preview.incomplete);
    assert!(preview.commits.is_empty());
    assert!(preview.files.is_empty());
}

#[tokio::test]
async fn test_gitlab_create_compare_marks_overflow_and_limited_diffs_incomplete() {
    for (overflow, collapsed, too_large) in [(true, false, false), (false, true, false), (false, false, true)] {
        let mock_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/group%2Frepo/repository/compare"))
            .and(query_param("from", "main"))
            .and(query_param("to", "feature"))
            .and(query_param("straight", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "compare_timeout": false,
                "compare_same_ref": false,
                "overflow": overflow,
                "commits": [{
                    "id": "abc123",
                    "title": "Large change",
                    "author_name": "Alice",
                    "authored_date": "2026-07-19T10:00:00Z"
                }],
                "diffs": [{
                    "old_path": "src/main.rs",
                    "new_path": "src/main.rs",
                    "diff": "",
                    "collapsed": collapsed,
                    "too_large": too_large
                }]
            })))
            .mount(&mock_server)
            .await;
        let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

        let preview = adapter
            .preview_pull_request(
                "group",
                "repo",
                &PrCreatePreviewRequest {
                    source_owner: "group".into(),
                    source_repo: "repo".into(),
                    source_branch: "feature".into(),
                    target_branch: "main".into(),
                    commit_sha: None,
                },
            )
            .await
            .unwrap();

        assert!(preview.incomplete);
        assert_eq!(preview.commits.len(), 1);
        assert_eq!(preview.files.len(), 1);
    }
}

#[tokio::test]
async fn test_gitlab_lists_all_branch_pages() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/branches"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "2")
                .set_body_json(serde_json::json!([{ "name": "main" }])),
        )
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/branches"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{ "name": "feature-101" }])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "default_branch": "main"
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let branches = adapter.list_branches("group", "repo").await.unwrap();

    assert_eq!(branches.branches, vec!["main", "feature-101"]);
}

#[tokio::test]
async fn test_gitlab_lists_repository_labels() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/labels"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200).insert_header("x-next-page", "2").set_body_json(
                serde_json::json!([{ "name": "bug", "color": "#d73a4a", "description": "Needs fixing" }]),
            ),
        )
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/labels"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{ "name": "feature" }])))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let labels = adapter.list_labels("group", "repo").await.unwrap();

    assert_eq!(labels.iter().map(|label| label.name.as_str()).collect::<Vec<_>>(), vec!["bug", "feature"]);
    assert_eq!(labels[0].color.as_deref(), Some("#d73a4a"));
    assert_eq!(labels[0].description.as_deref(), Some("Needs fixing"));
}

#[tokio::test]
async fn test_gitlab_lists_pr_participant_suggestions() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/members/all"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-next-page", "2").set_body_json(serde_json::json!([{
            "id": 1,
            "username": "alice",
            "name": "Alice Zhang",
            "avatar_url": "https://example.com/alice.png"
        }])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/members/all"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{
            "id": 2,
            "username": "bob",
            "name": "Bob",
            "avatar_url": ""
        }])))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let users = adapter.list_pr_participant_suggestions("group", "repo").await.unwrap();

    assert_eq!(users.iter().map(|user| user.login.as_str()).collect::<Vec<_>>(), vec!["alice", "bob"]);
    assert_eq!(users[0].name, "Alice Zhang");
}

#[tokio::test]
async fn test_gitlab_lists_mr_commits_reversed_to_oldest_first() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/octocat%2Fhello-world/merge_requests/42/commits"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {
                "id": "c2",
                "title": "第二个提交",
                "author_name": "Bob",
                "authored_date": "2026-07-19T11:00:00Z",
                "parent_ids": ["c1"]
            },
            {
                "id": "c1",
                "message": "第一个提交\n\n详情",
                "author_name": "Alice",
                "created_at": "2026-07-19T10:00:00Z",
                "parent_ids": ["base0"]
            }
        ])))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let list = adapter.list_pr_commits("octocat", "hello-world", 42).await.unwrap();

    assert!(list.truncated_end.is_none());
    // GitLab 按最新在前返回，adapter 必须翻转成「最早 → 最新」。
    assert_eq!(list.commits.iter().map(|c| c.sha.as_str()).collect::<Vec<_>>(), vec!["c1", "c2"]);
    assert_eq!(list.commits[0].title, "第一个提交");
    assert_eq!(list.commits[0].authored_at, "2026-07-19T10:00:00Z");
    assert_eq!(list.commits[0].parent_shas, vec!["base0".to_string()]);
    assert_eq!(list.commits[1].parent_shas, vec!["c1".to_string()]);
}

#[tokio::test]
async fn test_gitlab_marks_mr_commits_truncated_at_the_oldest_end() {
    let mock_server = MockServer::start().await;
    for page in 1..=3 {
        let commits = (0..100)
            .map(|index| {
                serde_json::json!({
                    "id": format!("page{page}-{index}"),
                    "title": "提交",
                    "author_name": "Alice",
                    "authored_date": "2026-07-19T10:00:00Z",
                    "parent_ids": []
                })
            })
            .collect::<Vec<_>>();
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/octocat%2Fhello-world/merge_requests/42/commits"))
            .and(query_param("page", page.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!(commits)))
            .mount(&mock_server)
            .await;
    }
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let list = adapter.list_pr_commits("octocat", "hello-world", 42).await.unwrap();

    assert_eq!(list.commits.len(), 300);
    // GitLab 最新在前，超出上限丢掉的是最早的提交 —— 与 GitHub / Gitee 相反。
    assert_eq!(list.truncated_end, Some(PrCommitTruncatedEnd::Oldest));
    // 翻转后末项仍是最新的一页里最新的提交。
    assert_eq!(list.commits.last().map(|commit| commit.sha.as_str()), Some("page1-0"));
}

#[tokio::test]
async fn test_gitlab_encodes_nested_subgroup_when_listing_mr_commits() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsub%2Frepo/merge_requests/7/commits"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let list = adapter.list_pr_commits("group/sub", "repo", 7).await.unwrap();

    assert!(list.commits.is_empty());
    assert!(list.truncated_end.is_none());
}

#[tokio::test]
async fn test_gitlab_previews_a_single_commit() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/contributor%2Frepo/repository/commits/abc123"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "abc123",
            "parent_ids": ["parent123"],
            "title": "Only this commit",
            "author_name": "Alice",
            "authored_date": "2026-07-19T10:00:00Z"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/contributor%2Frepo/repository/commits/abc123/diff"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{
            "old_path": "src/commit.rs",
            "new_path": "src/commit.rs",
            "diff": "@@ -1 +1 @@\n-old\n+new",
            "new_file": false,
            "deleted_file": false,
            "renamed_file": false
        }])))
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let preview = adapter
        .preview_pull_request(
            "group",
            "repo",
            &PrCreatePreviewRequest {
                source_owner: "contributor".into(),
                source_repo: "repo".into(),
                source_branch: "feature".into(),
                target_branch: "main".into(),
                commit_sha: Some("abc123".into()),
            },
        )
        .await
        .unwrap();

    assert_eq!(preview.commits[0].title, "Only this commit");
    assert_eq!(preview.base_revision.as_deref(), Some("parent123"));
    assert_eq!(preview.files[0].filename, "src/commit.rs");
}

#[tokio::test]
async fn test_gitlab_single_commit_preview_paginates_diffs() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/commits/abc123"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "abc123",
            "title": "Large commit",
            "author_name": "Alice",
            "authored_date": "2026-07-19T10:00:00Z"
        })))
        .mount(&mock_server)
        .await;
    let first_page = (0..100)
        .map(|index| {
            serde_json::json!({
                "old_path": format!("src/file-{index}.rs"),
                "new_path": format!("src/file-{index}.rs"),
                "diff": "@@ -1 +1 @@\n-old\n+new"
            })
        })
        .collect::<Vec<_>>();
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/commits/abc123/diff"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "2")
                .insert_header("x-total-pages", "2")
                .set_body_json(first_page),
        )
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/repository/commits/abc123/diff"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-next-page", "")
                .insert_header("x-total-pages", "2")
                .set_body_json(serde_json::json!([{
                    "old_path": "src/final.rs",
                    "new_path": "src/final.rs",
                    "diff": "@@ -1 +1 @@\n-old\n+new"
                }])),
        )
        .mount(&mock_server)
        .await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());

    let preview = adapter
        .preview_pull_request(
            "group",
            "repo",
            &PrCreatePreviewRequest {
                source_owner: "group".into(),
                source_repo: "repo".into(),
                source_branch: "feature".into(),
                target_branch: "main".into(),
                commit_sha: Some("abc123".into()),
            },
        )
        .await
        .unwrap();

    assert_eq!(preview.files.len(), 101);
    assert_eq!(preview.files.last().map(|file| file.filename.as_str()), Some("src/final.rs"));
    assert!(!preview.incomplete);
}

#[tokio::test]
async fn test_gitlab_list_repos_parses_pagination_headers() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v4/projects"))
        .and(query_param("page", "2"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-total-pages", "7")
                .insert_header("x-total", "612")
                .set_body_json(serde_json::json!([{
                    "id": 1,
                    "name": "repo",
                    "path_with_namespace": "group/repo",
                    "description": "",
                    "visibility": "private",
                    "namespace": { "kind": "group", "path": "group", "name": "Group" }
                }])),
        )
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result = adapter.list_repos(2).await.expect("should list repos");

    assert_eq!(result.page, 2);
    assert_eq!(result.total_pages, 7);
    assert_eq!(result.total_count, 612);
}

#[tokio::test]
async fn test_gitlab_list_repos_uses_next_page_when_total_pages_is_missing() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v4/projects"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-next-page", "2").set_body_json(serde_json::json!([])))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result = adapter.list_repos(1).await.expect("should list repos");

    assert_eq!(result.total_pages, 2);
}

#[tokio::test]
async fn test_gitlab_nested_subgroup_project_path_is_fully_encoded() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests"))
        .and(query_param("state", "opened"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-total-pages", "1")
                .insert_header("x-total", "0")
                .set_body_json(serde_json::json!([])),
        )
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result = adapter
        .list_pull_requests("group/subgroup", "repo", &PrState::Open, 1, 20)
        .await
        .expect("should list merge requests");

    assert!(result.items.is_empty());
}

#[tokio::test]
async fn test_gitlab_open_pr_list_uses_list_fields_for_status_summary() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests"))
        .and(query_param("state", "opened"))
        .respond_with(
            ResponseTemplate::new(200).insert_header("x-total-pages", "1").insert_header("x-total", "1").set_body_json(
                serde_json::json!([{
                    "iid": 3,
                    "title": "Blocked MR",
                    "author": gitlab_user(),
                    "state": "opened",
                    "merged_at": null,
                    "created_at": "2026-07-15T10:00:00Z",
                    "updated_at": "2026-07-16T10:00:00Z",
                    "labels": ["backend"],
                    "draft": true,
                    "has_conflicts": true,
                    "detailed_merge_status": "not_approved",
                    "head_pipeline": { "status": "failed" },
                    "blocking_discussions_resolved": false
                }]),
            ),
        )
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result =
        adapter.list_pull_requests("group", "repo", &PrState::Open, 1, 20).await.expect("should list merge requests");

    let status = result.items[0].status.as_ref().expect("open MR should expose status summary");
    assert_eq!(status.status, ReadinessState::Blocked);
    assert_eq!(status.approvals_status, ReadinessState::Blocked);
    assert_eq!(status.checks_status, ReadinessState::Blocked);
    assert_eq!(status.draft, Some(true));
    assert_eq!(status.has_conflicts, Some(true));
}

#[tokio::test]
async fn test_gitlab_closed_pr_list_omits_live_status_summary() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests"))
        .and(query_param("state", "closed"))
        .respond_with(
            ResponseTemplate::new(200).insert_header("x-total-pages", "1").insert_header("x-total", "1").set_body_json(
                serde_json::json!([{
                    "iid": 4,
                    "title": "Closed MR",
                    "author": gitlab_user(),
                    "state": "closed",
                    "merged_at": null,
                    "created_at": "2026-07-15T10:00:00Z",
                    "updated_at": "2026-07-16T10:00:00Z",
                    "labels": [],
                    "detailed_merge_status": "not_approved",
                    "head_pipeline": { "status": "failed" }
                }]),
            ),
        )
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result = adapter
        .list_pull_requests("group", "repo", &PrState::Closed, 1, 20)
        .await
        .expect("should list closed merge requests");

    assert!(result.items[0].status.is_none());
}

#[tokio::test]
async fn test_gitlab_rejects_reviewer_user_filter_as_gitee_only() {
    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".into());
    let query = PrListQuery { reviewer: "hubot".into(), ..PrListQuery::default() };
    let result = adapter.search_pull_requests("group", "repo", &PrState::Open, &query, 1, 20).await;

    assert!(result.is_err(), "GitLab 应拒绝 reviewer 用户筛选");
    let message = format!("{}", result.err().unwrap());
    assert!(message.contains("不支持") || message.contains("审查者"), "错误消息应说明不支持该筛选: {message}");
}

#[tokio::test]
async fn test_gitlab_searches_filters_sorts_and_paginates_merge_requests() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests"))
        .and(query_param("state", "opened"))
        .and(query_param("search", "fix"))
        .and(query_param("in", "title"))
        .and(query_param("author_username", "alice"))
        .and(query_param("assignee_username", "bob"))
        .and(query_param("labels", "bug"))
        .and(query_param("sort", "desc"))
        .and(query_param("page", "1"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).insert_header("x-total-pages", "1").set_body_json(serde_json::json!([
            {
                "iid": 11,
                "title": "Fix first bug",
                "author": {
                    "id": 1,
                    "username": "alice",
                    "name": "Alice",
                    "avatar_url": ""
                },
                "assignees": [{ "username": "bob" }],
                "reviewers": [{ "username": "reviewer" }],
                "state": "opened",
                "merged_at": null,
                "created_at": "2026-07-20T10:00:00Z",
                "updated_at": "2026-07-21T10:00:00Z",
                "labels": ["bug"],
                "detailed_merge_status": "mergeable",
                "user_notes_count": 3
            },
            {
                "iid": 12,
                "title": "Fix second bug",
                "author": {
                    "id": 1,
                    "username": "alice",
                    "name": "Alice",
                    "avatar_url": ""
                },
                "assignees": [{ "username": "bob" }],
                "reviewers": [{ "username": "reviewer" }],
                "state": "opened",
                "merged_at": null,
                "created_at": "2026-07-22T10:00:00Z",
                "updated_at": "2026-07-23T10:00:00Z",
                "labels": ["bug"],
                "detailed_merge_status": "can_be_merged",
                "user_notes_count": 9
            },
            {
                "iid": 13,
                "title": "Fix pending bug",
                "author": {
                    "id": 1,
                    "username": "alice",
                    "name": "Alice",
                    "avatar_url": ""
                },
                "assignees": [{ "username": "bob" }],
                "reviewers": [{ "username": "reviewer" }],
                "state": "opened",
                "merged_at": null,
                "created_at": "2026-07-24T10:00:00Z",
                "updated_at": "2026-07-25T10:00:00Z",
                "labels": ["bug"],
                "detailed_merge_status": "not_approved",
                "user_notes_count": 20
            }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".into()).with_base_url(mock_server.uri());
    let query = PrListQuery {
        title: "fix".into(),
        author: "alice".into(),
        label: "bug".into(),
        reviews: Some(PrReviewFilter::Approved),
        assignee: "bob".into(),
        reviewer: String::new(),
        sort: PrListSort::CommentsDesc,
    };
    let result = adapter
        .search_pull_requests("group/subgroup", "repo", &PrState::Open, &query, 1, 1)
        .await
        .expect("should search merge requests");

    assert_eq!(result.total_count, 2);
    assert_eq!(result.total_pages, 2);
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].number, 12);
    assert_eq!(result.truncated, None);
}

#[tokio::test]
async fn test_gitlab_uses_server_pagination_for_supported_pr_filters() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests"))
        .and(query_param("state", "opened"))
        .and(query_param("search", "fix"))
        .and(query_param("in", "title"))
        .and(query_param("author_username", "alice"))
        .and(query_param("labels", "bug"))
        .and(query_param("order_by", "updated_at"))
        .and(query_param("sort", "desc"))
        .and(query_param("page", "3"))
        .and(query_param("per_page", "20"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-total-pages", "5")
                .insert_header("x-total", "83")
                .set_body_json(serde_json::json!([{
                    "iid": 41,
                    "title": "Fix paged bug",
                    "author": {
                        "id": 1,
                        "username": "alice",
                        "name": "Alice",
                        "avatar_url": ""
                    },
                    "state": "opened",
                    "merged_at": null,
                    "created_at": "2026-07-20T10:00:00Z",
                    "updated_at": "2026-07-21T10:00:00Z",
                    "labels": ["bug"]
                }])),
        )
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".into()).with_base_url(mock_server.uri());
    let query = PrListQuery {
        title: "fix".into(),
        author: "alice".into(),
        label: "bug".into(),
        reviews: None,
        assignee: "".into(),
        reviewer: String::new(),
        sort: PrListSort::UpdatedDesc,
    };
    let result = adapter
        .search_pull_requests("group", "repo", &PrState::Open, &query, 3, 20)
        .await
        .expect("supported filters should use the requested server page");

    assert_eq!(result.page, 3);
    assert_eq!(result.total_pages, 5);
    assert_eq!(result.total_count, 83);
    assert_eq!(result.items[0].number, 41);
    assert_eq!(mock_server.received_requests().await.expect("requests").len(), 1);
}

#[tokio::test]
async fn test_gitlab_fetches_each_local_filter_page_once() {
    let mock_server = MockServer::start().await;
    for (page, number, comments) in [(1, 11, 1), (2, 12, 3), (3, 13, 2)] {
        let mut response = ResponseTemplate::new(200).set_body_json(serde_json::json!([{
            "iid": number,
            "title": format!("MR {number}"),
            "author": gitlab_user(),
            "state": "opened",
            "merged_at": null,
            "created_at": "2026-07-20T10:00:00Z",
            "updated_at": "2026-07-21T10:00:00Z",
            "labels": [],
            "user_notes_count": comments
        }]));
        if page == 1 {
            response = response.insert_header("x-total-pages", "3");
        }
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/group%2Frepo/merge_requests"))
            .and(query_param("page", page.to_string()))
            .and(query_param("per_page", "100"))
            .respond_with(response)
            .expect(1)
            .mount(&mock_server)
            .await;
    }

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".into()).with_base_url(mock_server.uri());
    let query = PrListQuery { sort: PrListSort::CommentsDesc, ..PrListQuery::default() };
    let result = adapter
        .search_pull_requests("group", "repo", &PrState::Open, &query, 1, 20)
        .await
        .expect("local sorting should collect all known pages");

    assert_eq!(result.items.iter().map(|item| item.number).collect::<Vec<_>>(), vec![12, 13, 11]);
    let mut requested_pages = mock_server
        .received_requests()
        .await
        .expect("requests")
        .iter()
        .filter_map(|request| {
            request.url.query_pairs().find_map(|(name, value)| (name == "page").then(|| value.into_owned()))
        })
        .collect::<Vec<_>>();
    requested_pages.sort();
    assert_eq!(requested_pages, ["1", "2", "3"]);
}

#[tokio::test]
async fn test_gitlab_pr_detail_exposes_base_and_head_revisions() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3/approvals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "approved_by": [{
                "user": {
                    "id": 2,
                    "username": "reviewer",
                    "name": "Reviewer",
                    "avatar_url": "",
                    "web_url": "javascript:alert(1)"
                }
            }]
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 3,
            "title": "MR",
            "author": gitlab_user(),
            "state": "opened",
            "merged_at": null,
            "created_at": "2026-07-15T10:00:00Z",
            "updated_at": "2026-07-15T10:00:00Z",
            "labels": [],
            "description": "",
            "source_branch": "feature",
            "target_branch": "main",
            "source_project_id": 7,
            "target_project_id": 7,
            "sha": "head-sha",
            "diff_refs": {"base_sha": "base-sha", "head_sha": "head-sha"},
            "draft": true,
            "reviewers": [{
                "id": 2,
                "username": "reviewer",
                "name": "Reviewer",
                "avatar_url": "",
                "web_url": "https://git.example.com/reviewer"
            }],
            "assignees": [{
                "id": 8,
                "username": "assignee",
                "name": "Assignee",
                "avatar_url": "",
                "web_url": "https://git.example.com/assignee"
            }],
            "milestone": {"id": 11, "iid": 2, "title": "0.6.0"},
            "web_url": "https://git.example.com/group/repo/-/merge_requests/3"
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let detail = adapter.get_pull_request("group", "repo", 3).await.expect("should load merge request");

    assert_eq!(detail.web_url.as_deref(), Some("https://git.example.com/group/repo/-/merge_requests/3"));
    assert_eq!(detail.head_sha, "head-sha");
    assert_eq!(detail.base_sha, "base-sha");
    assert_eq!(detail.base_repository_full_name.as_deref(), Some("group/repo"));
    assert_eq!(detail.head_repository_full_name.as_deref(), Some("group/repo"));
    assert_eq!(detail.draft, Some(true));
    assert_eq!(detail.reviewers[0].login, "reviewer");
    assert_eq!(detail.reviewer_statuses[0].status, PrReviewStatus::Approved);
    assert_eq!(detail.reviewer_statuses[0].web_url.as_deref(), Some("https://git.example.com/reviewer"));
    assert_eq!(detail.assignees[0].login, "assignee");
    assert_eq!(detail.assignee_statuses[0].status, PrReviewStatus::Pending);
    assert_eq!(detail.assignee_statuses[0].web_url.as_deref(), Some("https://git.example.com/assignee"));
    assert_eq!(detail.milestone.as_ref().map(|value| value.title.as_str()), Some("0.6.0"));
}

#[tokio::test]
async fn test_gitlab_fork_pr_detail_resolves_source_project_path() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 3,
            "title": "Fork MR",
            "author": gitlab_user(),
            "state": "opened",
            "merged_at": null,
            "created_at": "2026-07-15T10:00:00Z",
            "updated_at": "2026-07-15T10:00:00Z",
            "labels": [],
            "description": "",
            "source_branch": "feature",
            "target_branch": "main",
            "source_project_id": 17,
            "target_project_id": 7,
            "sha": "head-sha",
            "diff_refs": {"base_sha": "base-sha", "head_sha": "head-sha"},
            "reviewers": [{
                "id": 2,
                "username": "pending-reviewer",
                "name": "Pending Reviewer",
                "avatar_url": "",
                "web_url": "https://git.example.com/pending-reviewer"
            }]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3/approvals"))
        .respond_with(ResponseTemplate::new(403))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/17"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 17,
            "path_with_namespace": "fork-group/fork-repo"
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let detail = adapter.get_pull_request("group", "repo", 3).await.expect("should load fork merge request");

    assert_eq!(detail.base_repository_full_name.as_deref(), Some("group/repo"));
    assert_eq!(detail.head_repository_full_name.as_deref(), Some("fork-group/fork-repo"));
    assert_eq!(detail.reviewer_statuses[0].status, PrReviewStatus::Pending);
    assert_eq!(detail.reviewer_statuses[0].web_url.as_deref(), Some("https://git.example.com/pending-reviewer"));
}

#[tokio::test]
async fn test_gitlab_fork_pr_detail_preserves_detail_when_source_project_lookup_fails() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 3,
            "title": "Fork MR",
            "author": gitlab_user(),
            "state": "opened",
            "merged_at": null,
            "created_at": "2026-07-15T10:00:00Z",
            "updated_at": "2026-07-15T10:00:00Z",
            "labels": [],
            "description": "",
            "source_branch": "feature",
            "target_branch": "main",
            "source_project_id": 17,
            "target_project_id": 7,
            "sha": "head-sha",
            "diff_refs": {"base_sha": "base-sha", "head_sha": "head-sha"}
        })))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/17"))
        .respond_with(ResponseTemplate::new(403))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let detail = adapter.get_pull_request("group", "repo", 3).await.expect("should preserve merge request detail");

    assert_eq!(detail.base_repository_full_name.as_deref(), Some("group/repo"));
    assert_eq!(detail.head_repository_full_name, None);
}

#[tokio::test]
async fn test_gitlab_diff_wraps_bare_hunks_with_unified_diff_headers() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/4/changes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "changes": [
                {
                    "old_path": "src/old.rs",
                    "new_path": "src/new.rs",
                    "diff": "@@ -1 +1 @@\n-old\n+new",
                    "new_file": false,
                    "deleted_file": false,
                    "renamed_file": true
                },
                {
                    "old_path": "src/added.rs",
                    "new_path": "src/added.rs",
                    "diff": "@@ -0,0 +1 @@\n+added\n",
                    "new_file": true,
                    "deleted_file": false,
                    "renamed_file": false
                },
                {
                    "old_path": "src/deleted.rs",
                    "new_path": "src/deleted.rs",
                    "diff": "@@ -1 +0,0 @@\n-deleted",
                    "new_file": false,
                    "deleted_file": true,
                    "renamed_file": false
                }
            ]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let (diff, files) = adapter.get_pr_diff("group/subgroup", "repo", 4).await.expect("should load merge request diff");

    assert_eq!(files.len(), 3);
    assert_eq!(files[0].filename, "src/new.rs");
    assert!(diff.contains("diff --git a/src/old.rs b/src/new.rs\n--- a/src/old.rs\n+++ b/src/new.rs\n@@ -1 +1 @@"));
    assert!(diff.contains("diff --git a/src/added.rs b/src/added.rs\n--- /dev/null\n+++ b/src/added.rs\n@@ -0,0 +1 @@"));
    assert!(diff
        .contains("diff --git a/src/deleted.rs b/src/deleted.rs\n--- a/src/deleted.rs\n+++ /dev/null\n@@ -1 +0,0 @@"));
    assert!(diff.contains("+new\ndiff --git a/src/added.rs"));
    assert!(diff.ends_with('\n'));
}

#[tokio::test]
async fn test_gitlab_compare_diff_uses_nested_project_and_normalizes_rename() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/repository/compare"))
        .and(query_param("from", "base-sha"))
        .and(query_param("to", "head-sha"))
        .and(query_param("straight", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "compare_timeout": false,
            "compare_same_ref": false,
            "diffs": [
                {
                    "old_path": "src/main.rs",
                    "new_path": "src/main.rs",
                    "diff": "@@ -1 +1 @@\n-old\n+new",
                    "new_file": false,
                    "deleted_file": false,
                    "renamed_file": false
                },
                {
                    "old_path": "src/old-name.rs",
                    "new_path": "src/new-name.rs",
                    "diff": "",
                    "new_file": false,
                    "deleted_file": false,
                    "renamed_file": true,
                    "additions": 0,
                    "deletions": 0
                }
            ]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let (diff, files) = adapter
        .get_compare_diff("group/subgroup", "repo", "base-sha", "head-sha")
        .await
        .expect("should compare commits");
    let patches = mergebeacon_lib::patch::standardize_patches(&diff, &files);

    assert_eq!(files.len(), 2);
    assert!(diff.contains("diff --git a/src/main.rs b/src/main.rs"));
    assert!(diff.contains("rename from src/old-name.rs\nrename to src/new-name.rs"));
    assert!(matches!(files[1].status, mergebeacon_lib::models::FileStatus::Renamed));
    assert_eq!(patches[1].old_path.as_deref(), Some("src/old-name.rs"));
    assert_eq!(patches[1].new_path.as_deref(), Some("src/new-name.rs"));
}

#[tokio::test]
async fn test_gitlab_compare_diff_rejects_timeout_and_missing_diffs() {
    for (body, expected) in [
        (serde_json::json!({ "compare_timeout": true, "diffs": [] }), "compare 超时"),
        (serde_json::json!({ "compare_timeout": false }), "缺少 diffs 字段"),
    ] {
        let mock_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/group%2Frepo/repository/compare"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&mock_server)
            .await;

        let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
        let error = adapter
            .get_compare_diff("group", "repo", "base", "head")
            .await
            .expect_err("invalid compare response must fail");
        assert!(error.to_string().contains(expected));
    }
}

#[tokio::test]
async fn test_gitlab_diff_preserves_metadata_only_rename() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/5/changes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "changes": [
                {
                    "old_path": "src/old-name.rs",
                    "new_path": "src/new-name.rs",
                    "diff": "",
                    "new_file": false,
                    "deleted_file": false,
                    "renamed_file": true,
                    "additions": 0,
                    "deletions": 0
                },
                {
                    "old_path": "src/large-old.rs",
                    "new_path": "src/large-new.rs",
                    "diff": "",
                    "new_file": false,
                    "deleted_file": false,
                    "renamed_file": true,
                    "additions": 0,
                    "deletions": 0,
                    "too_large": true
                }
            ]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let (diff, files) = adapter.get_pr_diff("group", "repo", 5).await.expect("should load renamed file diff");
    let patches = mergebeacon_lib::patch::standardize_patches(&diff, &files);

    assert!(diff.contains("rename from src/old-name.rs\nrename to src/new-name.rs"));
    assert!(matches!(files[0].status, mergebeacon_lib::models::FileStatus::Renamed));
    assert!(matches!(patches[0].content_kind, mergebeacon_lib::models::PatchContentKind::MetadataOnly));
    assert_eq!(patches[0].old_path.as_deref(), Some("src/old-name.rs"));
    assert_eq!(patches[0].new_path.as_deref(), Some("src/new-name.rs"));
    assert!(matches!(patches[1].content_kind, mergebeacon_lib::models::PatchContentKind::Unavailable));
}

#[tokio::test]
async fn test_gitlab_creates_comment_only_overall_review() {
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/notes"))
        .and(body_json(serde_json::json!({ "body": "review summary" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "id": 60,
            "body": "review summary",
            "author": gitlab_user(),
            "created_at": "2026-07-15T10:00:00Z"
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let review = adapter
        .create_review("group", "repo", 10, "review summary", &ReviewEvent::Comment, &[])
        .await
        .expect("should create comment-only review");

    assert_eq!(review.kind, mergebeacon_lib::models::ReviewKind::OverallReview);
}

#[tokio::test]
async fn test_gitlab_rejects_unsupported_review_without_request() {
    let mock_server = MockServer::start().await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());

    let result = adapter.create_review("group", "repo", 1, "approve", &ReviewEvent::Approve, &[]).await;

    assert!(matches!(result, Err(AppError::NotImplemented(_))));
    assert!(mock_server.received_requests().await.unwrap().is_empty());
}

fn gitlab_user() -> serde_json::Value {
    serde_json::json!({
        "id": 7,
        "username": "reviewer",
        "name": "Reviewer",
        "avatar_url": "https://gitlab.example/avatar.png"
    })
}

fn gitlab_position() -> serde_json::Value {
    serde_json::json!({
        "position_type": "text",
        "base_sha": "base-sha",
        "start_sha": "start-sha",
        "head_sha": "head-sha",
        "old_path": "src/lib.rs",
        "new_path": "src/lib.rs",
        "new_line": 12
    })
}

fn gitlab_inline_discussion(id: u64) -> serde_json::Value {
    serde_json::json!({
        "id": format!("thread-{id}"),
        "notes": [{
            "id": id,
            "body": format!("comment-{id}"),
            "system": false,
            "resolvable": true,
            "resolved": false,
            "author": gitlab_user(),
            "created_at": "2026-07-15T10:00:00Z",
            "position": gitlab_position()
        }]
    })
}

#[tokio::test]
async fn test_gitlab_create_single_line_comment() {
    use wiremock::matchers::body_json;

    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "diff_refs": {
                "base_sha": "base-sha",
                "start_sha": "start-sha",
                "head_sha": "head-sha"
            }
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let position = gitlab_position();
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/3/discussions"))
        .and(body_json(serde_json::json!({
            "body": "please fix",
            "position": position
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "id": "discussion-1",
            "notes": [{
                "id": 42,
                "body": "please fix",
                "author": gitlab_user(),
                "created_at": "2026-07-15T10:00:00Z",
                "position": gitlab_position()
            }]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let comment = adapter
        .create_pr_comment("group/subgroup", "repo", 3, "head-sha", "src/lib.rs", None, 12, "right", "please fix")
        .await
        .expect("should create GitLab discussion comment");

    assert_eq!(comment.id, serde_json::json!(42));
    assert_eq!(comment.path, "src/lib.rs");
    assert_eq!(comment.line, Some(12));
    assert_eq!(comment.side.as_deref(), Some("right"));
    assert_eq!(comment.commit_id.as_deref(), Some("head-sha"));
}

#[tokio::test]
async fn test_gitlab_create_multiline_old_side_comment() {
    use sha1::{Digest, Sha1};
    use wiremock::matchers::body_json;

    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "diff_refs": {
                "base_sha": "base-sha",
                "start_sha": "start-sha",
                "head_sha": "head-sha"
            }
        })))
        .mount(&mock_server)
        .await;

    let hash = format!("{:x}", Sha1::digest(b"src/old.rs"));
    let position = serde_json::json!({
        "position_type": "text",
        "base_sha": "base-sha",
        "start_sha": "start-sha",
        "head_sha": "head-sha",
        "old_path": "src/old.rs",
        "new_path": "src/old.rs",
        "old_line": 9,
        "line_range": {
            "start": {
                "line_code": format!("{hash}_7_0"),
                "type": "old",
                "old_line": 7,
                "new_line": null
            },
            "end": {
                "line_code": format!("{hash}_9_0"),
                "type": "old",
                "old_line": 9,
                "new_line": null
            }
        }
    });
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/5/discussions"))
        .and(body_json(serde_json::json!({ "body": "old lines", "position": position })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "notes": [{
                "id": 43,
                "body": "old lines",
                "author": gitlab_user(),
                "created_at": "2026-07-15T10:00:00Z",
                "position": position
            }]
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let comment = adapter
        .create_pr_comment("group", "repo", 5, "head-sha", "src/old.rs", Some(7), 9, "left", "old lines")
        .await
        .expect("should create multiline comment");

    assert_eq!(comment.line, Some(9));
    assert_eq!(comment.start_line, Some(7));
    assert_eq!(comment.side.as_deref(), Some("left"));
}

#[tokio::test]
async fn test_gitlab_rejects_stale_comment_revision_without_posting() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/8"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "diff_refs": {
                "base_sha": "base-sha",
                "start_sha": "start-sha",
                "head_sha": "new-head-sha"
            }
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result =
        adapter.create_pr_comment("group", "repo", 8, "old-head-sha", "src/lib.rs", None, 3, "right", "stale").await;

    assert!(matches!(result, Err(AppError::Api(message)) if message.contains("刷新 Diff")));
    let requests = mock_server.received_requests().await.expect("requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method.as_str(), "GET");
}

#[tokio::test]
async fn test_gitlab_list_inline_comments_filters_regular_and_system_notes() {
    let mock_server = MockServer::start().await;
    let mut old_position = gitlab_position();
    old_position["new_line"] = serde_json::json!(10);
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {
                "id": "inline",
                "notes": [{
                    "id": 50,
                    "body": "inline note",
                    "system": false,
                    "resolvable": true,
                    "resolved": false,
                    "author": gitlab_user(),
                    "created_at": "2026-07-15T10:00:00Z",
                    "position": gitlab_position(),
                    "original_position": old_position
                }, {
                    "id": 53,
                    "body": "reply note",
                    "system": false,
                    "resolvable": false,
                    "author": gitlab_user(),
                    "created_at": "2026-07-15T11:00:00Z",
                    "position": null
                }]
            },
            {
                "id": "regular",
                "notes": [{
                    "id": 51,
                    "body": "regular note",
                    "system": false,
                    "author": gitlab_user(),
                    "created_at": "2026-07-15T10:00:00Z",
                    "position": null
                }]
            },
            {
                "id": "system",
                "notes": [{
                    "id": 52,
                    "body": "system note",
                    "system": true,
                    "author": gitlab_user(),
                    "created_at": "2026-07-15T10:00:00Z",
                    "position": gitlab_position()
                }]
            }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let comments = adapter.list_pr_comments("group", "repo", 9).await.expect("should list inline comments");

    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0].id, serde_json::json!(50));
    assert_eq!(comments[0].line, Some(12));
    assert_eq!(comments[0].side.as_deref(), Some("right"));
    assert_eq!(comments[0].original_line, Some(10));
    assert_eq!(comments[0].thread_id, "inline");
    assert_eq!(comments[0].resolved, Some(false));
    assert!(comments[0].resolvable);
    assert_eq!(comments[1].id, serde_json::json!(53));
    assert_eq!(comments[1].reply_to_id.as_deref(), Some("50"));
    assert_eq!(comments[1].line, Some(12));
}

#[tokio::test]
async fn test_gitlab_list_inline_comments_fetches_the_page_after_a_full_boundary() {
    let mock_server = MockServer::start().await;
    let first_page: Vec<_> = (1..=100).map(gitlab_inline_discussion).collect();
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(first_page))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![gitlab_inline_discussion(101)]))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let comments = adapter.list_pr_comments("group", "repo", 9).await.expect("should fetch every discussion page");

    assert_eq!(comments.len(), 101);
    assert_eq!(comments.first().map(|comment| &comment.id), Some(&serde_json::json!(1)));
    assert_eq!(comments.last().map(|comment| &comment.id), Some(&serde_json::json!(101)));
}

#[tokio::test]
async fn test_gitlab_list_inline_comments_reports_platform_errors() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions"))
        .respond_with(ResponseTemplate::new(503).set_body_string(r#"{"message":"temporarily unavailable"}"#))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let error = adapter.list_pr_comments("group", "repo", 9).await.expect_err("platform errors must be returned");

    assert!(error.to_string().contains("GitLab API 503 Service Unavailable"));
    assert!(error.to_string().contains("temporarily unavailable"));
}

#[tokio::test]
async fn test_gitlab_resolves_and_reopens_discussion() {
    let mock_server = MockServer::start().await;
    for resolved in [true, false] {
        Mock::given(method("PUT"))
            .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions/thread-1"))
            .and(body_json(serde_json::json!({ "resolved": resolved })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "thread-1",
                "resolved": resolved
            })))
            .expect(1)
            .mount(&mock_server)
            .await;
    }

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    adapter.set_review_thread_resolved("group", "repo", 9, "thread-1", true).await.expect("should resolve discussion");
    adapter.set_review_thread_resolved("group", "repo", 9, "thread-1", false).await.expect("should reopen discussion");
}

#[tokio::test]
async fn test_gitlab_replies_edits_and_deletes_discussion_note() {
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions/thread-1/notes"))
        .and(body_json(serde_json::json!({ "body": "回复" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions/thread-1/notes/50"))
        .and(body_json(serde_json::json!({ "body": "编辑后" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/discussions/thread-1/notes/50"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".into())
        .with_base_url(format!("{}/api/v4", mock_server.uri()));
    adapter.reply_to_review_thread("group", "repo", 9, "thread-1", "50", "回复").await.expect("reply should succeed");
    adapter.update_review_comment("group", "repo", 9, "thread-1", "50", "编辑后").await.expect("edit should succeed");
    adapter.delete_review_comment("group", "repo", 9, "thread-1", "50").await.expect("delete should succeed");
}

#[tokio::test]
async fn test_gitlab_rejects_invalid_comment_input_before_request() {
    let mock_server = MockServer::start().await;
    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());

    let invalid_side =
        adapter.create_pr_comment("group", "repo", 1, "head", "src/lib.rs", None, 1, "middle", "comment").await;
    let invalid_range =
        adapter.create_pr_comment("group", "repo", 1, "head", "src/lib.rs", Some(3), 2, "right", "comment").await;

    assert!(matches!(invalid_side, Err(AppError::Api(_))));
    assert!(matches!(invalid_range, Err(AppError::Api(_))));
    assert!(mock_server.received_requests().await.expect("requests").is_empty());
}

#[tokio::test]
async fn test_gitlab_list_reviews_excludes_inline_discussion_notes() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/notes"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {
                "id": 60,
                "body": "general review",
                "system": false,
                "author": gitlab_user(),
                "created_at": "2026-07-15T10:00:00Z",
                "position": null
            },
            {
                "id": 61,
                "body": "inline note",
                "system": false,
                "author": gitlab_user(),
                "created_at": "2026-07-15T10:00:00Z",
                "position": gitlab_position()
            }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let reviews = adapter.list_reviews("group", "repo", 10).await.expect("should list reviews");

    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0].id, serde_json::json!(60));
    assert_eq!(reviews[0].kind, mergebeacon_lib::models::ReviewKind::OverallReview);
}

#[tokio::test]
async fn test_gitlab_list_reviews_fetches_the_page_after_a_full_boundary() {
    let mock_server = MockServer::start().await;
    let first_page: Vec<_> = (1..=100)
        .map(|id| {
            serde_json::json!({
                "id": id,
                "body": format!("general-{id}"),
                "system": false,
                "author": gitlab_user(),
                "created_at": "2026-07-15T10:00:00Z",
                "position": null
            })
        })
        .collect();
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/notes"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(first_page))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/notes"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{
            "id": 101,
            "body": "general-101",
            "system": false,
            "author": gitlab_user(),
            "created_at": "2026-07-15T10:00:00Z",
            "position": null
        }])))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let reviews = adapter.list_reviews("group", "repo", 10).await.expect("should fetch every note page");

    assert_eq!(reviews.len(), 101);
    assert_eq!(reviews.first().map(|review| &review.id), Some(&serde_json::json!(1)));
    assert_eq!(reviews.last().map(|review| &review.id), Some(&serde_json::json!(101)));
    assert!(reviews.iter().all(|review| review.kind == mergebeacon_lib::models::ReviewKind::OverallReview));
}

#[tokio::test]
async fn test_gitlab_merge_readiness_keeps_failed_pipeline_lookup_from_being_ready() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 9,
            "state": "opened",
            "draft": false,
            "detailed_merge_status": "mergeable",
            "has_conflicts": false,
            "sha": "head-sha",
            "diff_refs": {"head_sha": "head-sha"},
            "user": {"can_merge": true}
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/pipelines"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/9/approvals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "approvals_required": 0,
            "approvals_left": 0,
            "approved_by": []
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let readiness = adapter.get_merge_readiness("group", "repo", 9).await.expect("readiness");

    assert_eq!(readiness.status, mergebeacon_lib::models::ReadinessState::Unknown);
    assert_eq!(readiness.checks_status, mergebeacon_lib::models::ReadinessState::Unknown);
    assert_eq!(readiness.head_sha, "head-sha");
}

#[tokio::test]
async fn test_gitlab_merge_readiness_allows_merge_without_configured_pipeline() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 12,
            "state": "opened",
            "draft": false,
            "detailed_merge_status": "mergeable",
            "sha": "head-sha",
            "user": {"can_merge": true}
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/12/pipelines"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/12/approvals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "approvals_required": 0,
            "approvals_left": 0,
            "approved_by": []
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let readiness = adapter.get_merge_readiness("group", "repo", 12).await.expect("readiness");

    assert_eq!(readiness.status, mergebeacon_lib::models::ReadinessState::Ready);
    assert_eq!(readiness.checks_status, mergebeacon_lib::models::ReadinessState::Ready);
    assert_eq!(readiness.has_conflicts, Some(false));
    assert_eq!(readiness.has_merge_permission, Some(true));
}

#[tokio::test]
async fn test_gitlab_merge_readiness_blocks_user_without_merge_permission() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 10,
            "state": "opened",
            "draft": false,
            "detailed_merge_status": "mergeable",
            "has_conflicts": false,
            "sha": "head-sha",
            "user": {"can_merge": false}
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/pipelines"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"status": "success"}
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/10/approvals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "approvals_required": 0,
            "approvals_left": 0,
            "approved_by": []
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let readiness = adapter.get_merge_readiness("group", "repo", 10).await.expect("readiness");

    assert_eq!(readiness.status, mergebeacon_lib::models::ReadinessState::Blocked);
    assert_eq!(readiness.has_merge_permission, Some(false));
    assert!(readiness
        .blocking_reasons
        .iter()
        .any(|reason| reason.code == mergebeacon_lib::models::MergeBlockingReasonCode::NoMergePermission));
}

#[tokio::test]
async fn test_gitlab_merge_readiness_is_ready_with_merge_permission() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/11"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "iid": 11,
            "state": "opened",
            "draft": false,
            "detailed_merge_status": "mergeable",
            "has_conflicts": false,
            "sha": "head-sha",
            "user": {"can_merge": true}
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/11/pipelines"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"status": "success"}
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/11/approvals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "approvals_required": 0,
            "approvals_left": 0,
            "approved_by": []
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let readiness = adapter.get_merge_readiness("group", "repo", 11).await.expect("readiness");

    assert_eq!(readiness.status, mergebeacon_lib::models::ReadinessState::Ready);
    assert_eq!(readiness.has_merge_permission, Some(true));
    assert!(readiness.blocking_reasons.is_empty());
}

#[tokio::test]
async fn test_gitlab_file_content_encodes_nested_project_and_file_path() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Fsubgroup%2Frepo/repository/files/src%2Fa%20b.rs"))
        .and(query_param("ref", "base-sha"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "encoding": "base64",
            "content": "Zm4gbWFpbigpIHt9Cg==",
            "size": 13
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let content =
        adapter.get_pr_file_content("group/subgroup", "repo", "src/a b.rs", "base-sha").await.expect("file content");

    assert_eq!(content.content, "fn main() {}\n");
    assert_eq!(content.revision, "base-sha");
}

#[tokio::test]
async fn test_gitlab_review_inbox_combines_reviewers_and_assignees() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 7,
            "username": "reviewer",
            "name": "Reviewer",
            "avatar_url": ""
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/merge_requests"))
        .and(query_param("scope", "all"))
        .and(query_param("state", "opened"))
        .and(query_param("reviewer_id", "7"))
        .and(query_param("page", "1"))
        .and(query_param("per_page", "100"))
        .respond_with(
            ResponseTemplate::new(200).append_header("x-total", "1").append_header("x-total-pages", "1").set_body_json(
                serde_json::json!([{
                    "iid": 9,
                    "title": "Nested project MR",
                    "state": "opened",
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-03T00:00:00Z",
                    "sha": "head-9",
                    "user_notes_count": 4,
                    "author": { "id": 1, "username": "dev", "name": "Dev", "avatar_url": "" },
                    "labels": ["backend"],
                    "references": { "full": "group/subgroup/project!9" },
                    "draft": false,
                    "has_conflicts": false,
                    "detailed_merge_status": "not_approved",
                    "head_pipeline": { "status": "success" }
                }]),
            ),
        )
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/merge_requests"))
        .and(query_param("assignee_id", "7"))
        .and(query_param("page", "1"))
        .and(query_param("per_page", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {
                "iid": 9,
                "title": "Nested project MR",
                "state": "opened",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-03T00:00:00Z",
                "sha": "head-9",
                "user_notes_count": 4,
                "author": { "id": 1, "username": "dev", "name": "Dev", "avatar_url": "" },
                "labels": ["backend"],
                "references": { "full": "group/subgroup/project!9" },
                "draft": false,
                "has_conflicts": false,
                "detailed_merge_status": "not_approved",
                "head_pipeline": { "status": "success" }
            },
            {
                "iid": 10,
                "title": "Assigned MR",
                "state": "opened",
                "created_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-02T00:00:00Z",
                "author": { "id": 2, "username": "dev2", "name": "Dev 2", "avatar_url": "" },
                "labels": [],
                "references": { "full": "group/assigned!10" },
                "draft": false,
                "has_conflicts": false,
                "detailed_merge_status": "can_be_merged",
                "head_pipeline": { "status": "success" }
            }
        ])))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());
    let result = adapter
        .list_review_inbox(&ReviewInboxCategory::ReviewRequested, 1, 20)
        .await
        .expect("should list review inbox");

    assert_eq!(result.total_count, 2);
    assert_eq!(result.items.iter().map(|item| item.summary.number).collect::<Vec<_>>(), vec![9, 10]);
    assert_eq!(result.items[0].owner, "group/subgroup");
    assert_eq!(result.items[0].repo, "project");
    assert_eq!(result.items[0].repository_full_name, "group/subgroup/project");
    assert_eq!(result.items[0].platform, "gitlab");
    assert_eq!(
        result.items[0].relationships,
        vec![ReviewInboxRelationship::Reviewer, ReviewInboxRelationship::Assignee]
    );
    assert_eq!(result.items[0].status.status, ReadinessState::Blocked);
    assert_eq!(result.items[0].status.checks_status, ReadinessState::Ready);
    assert_eq!(result.items[0].status.approvals_status, ReadinessState::Blocked);
    assert_eq!(result.items[0].head_sha.as_deref(), Some("head-9"));
    assert_eq!(result.items[0].comments_count, Some(4));
    assert_eq!(result.items[1].repository_full_name, "group/assigned");
    assert_eq!(result.items[1].relationships, vec![ReviewInboxRelationship::Assignee]);
    assert_eq!(result.items[1].status.status, ReadinessState::Ready);
}

#[tokio::test]
async fn test_gitlab_updates_merge_request_metadata() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users"))
        .and(query_param("username", "new-reviewer"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 12, "username": "new-reviewer" }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users"))
        .and(query_param("username", "new-assignee"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 13, "username": "new-assignee" }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/milestones"))
        .and(query_param("state", "all"))
        .and(query_param("title", "0.7.0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 8, "title": "0.7.0" }
        ])))
        .expect(1)
        .mount(&mock_server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3"))
        .and(body_json(serde_json::json!({
            "title": "Draft: New title",
            "description": "New body",
            "reviewer_ids": [12],
            "assignee_ids": [13],
            "labels": "new-label",
            "milestone_id": 8
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&mock_server)
        .await;

    let current = PrDetail {
        summary: PrSummary {
            number: 3,
            title: "Old title".into(),
            author: User { id: serde_json::json!(1), login: "author".into(), name: "".into(), avatar_url: "".into() },
            state: PrState::Open,
            created_at: "2026-07-16T00:00:00Z".into(),
            updated_at: "2026-07-17T00:00:00Z".into(),
            label_colors: Default::default(),
            labels: vec!["old-label".into()],
            status: None,
        },
        body: "Old body".into(),
        source_branch: "feature".into(),
        target_branch: "main".into(),
        base_repository_full_name: None,
        head_repository_full_name: None,
        mergeable: None,
        head_sha: "head".into(),
        base_sha: "base".into(),
        draft: Some(false),
        reviewers: vec![User {
            id: serde_json::json!(2),
            login: "old-reviewer".into(),
            name: "".into(),
            avatar_url: "".into(),
        }],
        reviewer_statuses: Vec::new(),
        assignee_statuses: Vec::new(),
        assignees: vec![User {
            id: serde_json::json!(3),
            login: "old-assignee".into(),
            name: "".into(),
            avatar_url: "".into(),
        }],
        milestone: Some(PrMilestone { id: serde_json::json!(7), number: Some(7), title: "0.6.0".into() }),
        metadata_permissions: PrMetadataPermissions::default(),
        web_url: None,
    };
    let update = PrMetadataUpdate {
        title: "New title".into(),
        body: "New body".into(),
        draft: Some(true),
        reviewers: vec!["new-reviewer".into()],
        assignees: vec!["new-assignee".into()],
        labels: vec!["new-label".into()],
        milestone: Some("0.7.0".into()),
        expected_updated_at: current.summary.updated_at.clone(),
    };
    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());

    let result = adapter
        .update_pull_request_metadata("group", "repo", 3, &current, &update)
        .await
        .expect("metadata update should succeed");

    assert!(result.failures.is_empty());
    assert_eq!(
        result.updated_fields,
        vec![
            PrMetadataField::TitleBody,
            PrMetadataField::Draft,
            PrMetadataField::Reviewers,
            PrMetadataField::Assignees,
            PrMetadataField::Labels,
            PrMetadataField::Milestone,
        ]
    );
}

#[tokio::test]
async fn test_gitlab_clears_merge_request_milestone_with_zero_id() {
    let mock_server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/api/v4/projects/group%2Frepo/merge_requests/3"))
        .and(body_json(serde_json::json!({ "milestone_id": 0 })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&mock_server)
        .await;

    let current = PrDetail {
        summary: PrSummary {
            number: 3,
            title: "Title".into(),
            author: User { id: serde_json::json!(1), login: "author".into(), name: "".into(), avatar_url: "".into() },
            state: PrState::Open,
            created_at: "2026-07-16T00:00:00Z".into(),
            updated_at: "2026-07-17T00:00:00Z".into(),
            label_colors: Default::default(),
            labels: Vec::new(),
            status: None,
        },
        body: "Body".into(),
        source_branch: "feature".into(),
        target_branch: "main".into(),
        base_repository_full_name: None,
        head_repository_full_name: None,
        mergeable: None,
        head_sha: "head".into(),
        base_sha: "base".into(),
        draft: Some(false),
        reviewers: Vec::new(),
        reviewer_statuses: Vec::new(),
        assignee_statuses: Vec::new(),
        assignees: Vec::new(),
        milestone: Some(PrMilestone { id: serde_json::json!(7), number: Some(7), title: "0.6.0".into() }),
        metadata_permissions: PrMetadataPermissions::default(),
        web_url: None,
    };
    let update = PrMetadataUpdate {
        title: current.summary.title.clone(),
        body: current.body.clone(),
        draft: current.draft,
        reviewers: Vec::new(),
        assignees: Vec::new(),
        labels: Vec::new(),
        milestone: None,
        expected_updated_at: current.summary.updated_at.clone(),
    };
    let adapter = GitLabAdapter::new(HttpClient::new(), "test-token".to_string()).with_base_url(mock_server.uri());

    let result = adapter
        .update_pull_request_metadata("group", "repo", 3, &current, &update)
        .await
        .expect("milestone removal should succeed");

    assert!(result.failures.is_empty());
    assert_eq!(result.updated_fields, vec![PrMetadataField::Milestone]);
}

#[tokio::test]
async fn test_gitlab_lists_issue_templates() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/templates/issues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "name": "Bug" },
            { "name": "Feature request" }
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/templates/issues/Bug"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "name": "Bug",
            "content": "## 复现步骤\n"
        })))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/templates/issues/Feature%20request"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "name": "Feature request",
            "content": "## 使用场景\n"
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let templates = adapter.list_issue_templates("group", "repo").await.unwrap();

    assert_eq!(templates.iter().map(|item| item.name.as_str()).collect::<Vec<_>>(), vec!["Bug", "Feature request"]);
    assert_eq!(templates[1].body, "## 使用场景");
}

#[tokio::test]
async fn test_gitlab_uploads_pr_description_image() {
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/proxy/api/v4/projects/group%2Frepo/uploads"))
        .and(header("private-token", "token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "alt": "clipboard.png",
            "url": "/uploads/hash/clipboard.png",
            "full_path": "/proxy/group/repo/uploads/hash/clipboard.png",
            "markdown": "![clipboard.png](/uploads/hash/clipboard.png)"
        })))
        .mount(&mock_server)
        .await;

    let adapter =
        GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(format!("{}/proxy", mock_server.uri()));
    let upload = adapter
        .upload_pr_description_image(
            "group",
            "repo",
            "clipboard.png",
            "image/png",
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .await
        .unwrap();

    assert_eq!(upload.markdown, "![clipboard.png](/uploads/hash/clipboard.png)");
    assert_eq!(
        upload.preview_markdown,
        format!("![clipboard.png]({}/proxy/group/repo/uploads/hash/clipboard.png)", mock_server.uri())
    );

    let requests = mock_server.received_requests().await.expect("requests");
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    let content_type =
        request.headers.get("content-type").and_then(|value| value.to_str().ok()).expect("multipart content type");
    assert!(content_type.starts_with("multipart/form-data; boundary="), "{content_type}");
    let body_text = String::from_utf8_lossy(&request.body);
    assert!(body_text.contains("filename=\"clipboard.png\""));
    assert!(body_text.contains("Content-Type: image/png"));
    assert!(request.body.windows(8).any(|bytes| bytes == [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]));
}

#[tokio::test]
async fn test_gitlab_rejects_untrusted_pr_description_image_markdown() {
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/projects/group%2Frepo/uploads"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "url": "/uploads/hash/clipboard.png",
            "full_path": "/group/repo/uploads/hash/clipboard.png",
            "markdown": "proxy injected text ![clipboard.png](/uploads/hash/clipboard.png)"
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let error = adapter
        .upload_pr_description_image(
            "group",
            "repo",
            "clipboard.png",
            "image/png",
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .await
        .expect_err("unexpected Markdown must be rejected");

    assert!(matches!(error, AppError::Api(message) if message.contains("Markdown 无效")));
}

#[tokio::test]
async fn test_gitlab_lists_pr_templates() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/templates/merge_requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "name": "Feature request" }
        ])))
        .mount(&mock_server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/projects/group%2Frepo/templates/merge_requests/Feature%20request"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "name": "Feature request",
            "content": "## Changes\n\n- [ ] Tested\n"
        })))
        .mount(&mock_server)
        .await;

    let adapter = GitLabAdapter::new(HttpClient::new(), "token".into()).with_base_url(mock_server.uri());
    let templates = adapter.list_pr_templates("group", "repo").await.unwrap();

    assert_eq!(templates.len(), 1);
    assert_eq!(templates[0].name, "Feature request");
    assert_eq!(templates[0].body, "## Changes\n\n- [ ] Tested");
    assert_eq!(templates[0].source_path, ".gitlab/merge_request_templates/Feature request.md");
}
