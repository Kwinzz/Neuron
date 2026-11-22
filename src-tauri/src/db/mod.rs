//! SQLite access. All queries go through [`Db::call`], which runs on Tokio's blocking pool
//! so the async runtime (and therefore the UI) never waits on disk I/O.

pub mod chat;
pub mod memories;
pub mod migrations;
pub mod projects;
pub mod providers;
pub mod settings;
pub mod threads;
pub mod usage;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    /// Open (or create) the database file, configure it and apply pending migrations.
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        configure(&conn, true)?;
        migrations::apply(&mut conn)?;
        Ok(Self::from_conn(conn))
    }

    /// In-memory database with the full schema (tests).
    pub fn open_in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        configure(&conn, false)?;
        migrations::apply(&mut conn)?;
        Ok(Self::from_conn(conn))
    }

    fn from_conn(conn: Connection) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    /// Synchronous access, for startup code that runs before the async runtime is relevant.
    pub fn blocking<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Connection) -> AppResult<T>,
    {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| AppError::Other("database mutex poisoned".into()))?;
        f(&mut guard)
    }

    /// Run `f` with exclusive access to the connection on the blocking thread pool.
    pub async fn call<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::Other("database mutex poisoned".into()))?;
            f(&mut guard)
        })
        .await?
    }
}

fn configure(conn: &Connection, file_backed: bool) -> AppResult<()> {
    if file_backed {
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    }
    conn.execute_batch(
        "PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn call_runs_on_blocking_pool() {
        let db = Db::open_in_memory().expect("open");
        let fk: i64 = db
            .call(|c| Ok(c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?))
            .await
            .expect("query");
        assert_eq!(fk, 1);
    }
}
