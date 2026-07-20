use rusqlite::{params, Connection, Row};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone)]
pub struct CommentSnapshot {
    pub comment_id: String,
    pub platform: String,
    pub owner: String,
    pub repo: String,
    pub pr_number: u64,
    pub commit_id: Option<String>,
    pub original_commit_id: Option<String>,
    pub diff_hunk: Option<String>,
    pub original_line: Option<u32>,
    pub original_start_line: Option<u32>,
}

pub struct CommentSnapshotStore {
    conn: Mutex<Connection>,
}

impl CommentSnapshotStore {
    pub fn new(db_path: &Path) -> Self {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(db_path).expect("Failed to open SQLite database");
        Self::from_connection(conn)
    }

    fn from_connection(conn: Connection) -> Self {
        conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS comment_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comment_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                commit_id TEXT,
                original_commit_id TEXT,
                diff_hunk TEXT,
                original_line INTEGER,
                original_start_line INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(comment_id, platform)
            );",
        )
        .expect("Failed to create comment_snapshots table");
        Self { conn: Mutex::new(conn) }
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self::from_connection(Connection::open_in_memory().expect("Failed to open in-memory SQLite database"))
    }

    pub fn is_available(&self) -> bool {
        self.conn.lock().map(|conn| conn.query_row("SELECT 1", [], |_| Ok(())).is_ok()).unwrap_or(false)
    }

    pub fn save_snapshot(&self, snapshot: &CommentSnapshot) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO comment_snapshots
                (comment_id, platform, owner, repo, pr_number, commit_id, original_commit_id, diff_hunk, original_line, original_start_line)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                snapshot.comment_id,
                snapshot.platform,
                snapshot.owner,
                snapshot.repo,
                snapshot.pr_number,
                snapshot.commit_id,
                snapshot.original_commit_id,
                snapshot.diff_hunk,
                snapshot.original_line,
                snapshot.original_start_line,
            ],
        )?;
        Ok(())
    }

    pub fn get_snapshot(&self, comment_id: &str, platform: &str) -> Result<Option<CommentSnapshot>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT comment_id, platform, owner, repo, pr_number, commit_id, original_commit_id, diff_hunk, original_line, original_start_line
             FROM comment_snapshots
             WHERE comment_id = ?1 AND platform = ?2"
        )?;
        let mut rows = stmt.query(params![comment_id, platform])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::snapshot_from_row(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn delete_snapshot(&self, comment_id: &str, platform: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM comment_snapshots WHERE comment_id = ?1 AND platform = ?2",
            params![comment_id, platform],
        )?;
        Ok(())
    }

    pub fn get_snapshots_for_pr(
        &self,
        platform: &str,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<CommentSnapshot>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT comment_id, platform, owner, repo, pr_number, commit_id, original_commit_id, diff_hunk, original_line, original_start_line
             FROM comment_snapshots
             WHERE platform = ?1 AND owner = ?2 AND repo = ?3 AND pr_number = ?4"
        )?;
        let rows = stmt.query_map(params![platform, owner, repo, pr_number as i64], Self::snapshot_from_row)?;
        let mut snapshots = Vec::new();
        for row in rows {
            snapshots.push(row?);
        }
        Ok(snapshots)
    }

    fn snapshot_from_row(row: &Row<'_>) -> Result<CommentSnapshot, rusqlite::Error> {
        let pr_number = row.get::<_, i64>(4)?;
        let pr_number = u64::try_from(pr_number).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(4, pr_number))?;
        let diff_hunk = row.get::<_, Option<String>>(7)?.filter(|hunk| !hunk.trim().is_empty());
        let original_line = row.get::<_, Option<i64>>(8)?.and_then(|line| u32::try_from(line).ok());
        let original_start_line = row.get::<_, Option<i64>>(9)?.and_then(|line| u32::try_from(line).ok());
        Ok(CommentSnapshot {
            comment_id: row.get(0)?,
            platform: row.get(1)?,
            owner: row.get(2)?,
            repo: row.get(3)?,
            pr_number,
            commit_id: row.get(5)?,
            original_commit_id: row.get(6)?,
            diff_hunk,
            original_line,
            original_start_line,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(comment_id: &str, platform: &str, repo: &str, pr_number: u64) -> CommentSnapshot {
        CommentSnapshot {
            comment_id: comment_id.to_string(),
            platform: platform.to_string(),
            owner: "team".to_string(),
            repo: repo.to_string(),
            pr_number,
            commit_id: Some("head".to_string()),
            original_commit_id: Some("original-head".to_string()),
            diff_hunk: Some("@@ -7 +7 @@\n-old\n+new".to_string()),
            original_line: Some(7),
            original_start_line: None,
        }
    }

    #[test]
    fn isolates_snapshots_by_platform_and_pull_request() {
        let store = CommentSnapshotStore::in_memory();
        store.save_snapshot(&snapshot("10", "github", "repo", 1)).unwrap();
        store.save_snapshot(&snapshot("10", "gitlab", "repo", 1)).unwrap();
        store.save_snapshot(&snapshot("11", "github", "other", 2)).unwrap();

        let snapshots = store.get_snapshots_for_pr("github", "team", "repo", 1).unwrap();

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].comment_id, "10");
        assert_eq!(snapshots[0].platform, "github");
        assert_eq!(snapshots[0].repo, "repo");
        assert_eq!(snapshots[0].pr_number, 1);
    }

    #[test]
    fn replaces_the_saved_context_for_the_same_comment() {
        let store = CommentSnapshotStore::in_memory();
        let mut first = snapshot("10", "github", "repo", 1);
        store.save_snapshot(&first).unwrap();
        first.diff_hunk = Some("@@ -9 +9 @@\n-before\n+after".to_string());
        first.original_line = Some(9);
        store.save_snapshot(&first).unwrap();

        let saved = store.get_snapshot("10", "github").unwrap().unwrap();

        assert_eq!(saved.diff_hunk, first.diff_hunk);
        assert_eq!(saved.original_line, Some(9));
    }

    #[test]
    fn ignores_blank_hunks_and_invalid_line_numbers_from_local_data() {
        let store = CommentSnapshotStore::in_memory();
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO comment_snapshots
                (comment_id, platform, owner, repo, pr_number, diff_hunk, original_line, original_start_line)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["corrupt", "gitlab", "team", "repo", 9_i64, "   ", -1_i64, u32::MAX as i64 + 1],
        )
        .unwrap();
        drop(conn);

        let saved = store.get_snapshot("corrupt", "gitlab").unwrap().unwrap();

        assert_eq!(saved.diff_hunk, None);
        assert_eq!(saved.original_line, None);
        assert_eq!(saved.original_start_line, None);
    }
}
