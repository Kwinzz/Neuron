//! Global memory rows (`memories` + `memories_fts`).

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::memory::{Memory, MemoryCategory, MemoryHit};

const SELECT: &str = "SELECT m.id, m.category, m.content, m.source, m.created_at, m.updated_at FROM memories m";

fn map_row(row: &Row<'_>) -> rusqlite::Result<Memory> {
    let category: String = row.get(1)?;
    Ok(Memory {
        id: row.get(0)?,
        category: MemoryCategory::from_db(&category),
        content: row.get(2)?,
        source: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

/// All memories, in category order then creation order.
pub fn list(conn: &Connection) -> AppResult<Vec<Memory>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY m.created_at, m.rowid"))?;
    let mut rows = stmt.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?;
    rows.sort_by_key(|m| m.category.rank());
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Memory>> {
    Ok(conn.query_row(&format!("{SELECT} WHERE m.id = ?1"), [id], map_row).optional()?)
}

pub fn insert(
    conn: &Connection,
    category: MemoryCategory,
    content: &str,
    source: &str,
    now: i64,
) -> AppResult<Memory> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::Invalid("souvenir vide".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO memories (id, category, content, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, category.as_db(), content, source, now],
    )?;
    get(conn, &id)?.ok_or_else(|| AppError::NotFound(id))
}

pub fn update(conn: &Connection, id: &str, category: MemoryCategory, content: &str, now: i64) -> AppResult<Memory> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::Invalid("souvenir vide".into()));
    }
    let changed = conn.execute(
        "UPDATE memories SET category = ?2, content = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, category.as_db(), content, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("souvenir {id}")));
    }
    get(conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.execute("DELETE FROM memories WHERE id = ?1", [id])? > 0)
}

/// FTS5 query from free text: each word as a prefix term, OR-ed, ranked by bm25.
fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(12)
        .map(|w| format!("\"{}\"*", w.to_lowercase()))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" OR "))
}

pub fn search(conn: &Connection, text: &str, limit: usize) -> AppResult<Vec<MemoryHit>> {
    let Some(query) = fts_query(text) else { return Ok(Vec::new()) };
    let limit = i64::try_from(limit.clamp(1, 50)).unwrap_or(10);
    let mut stmt = conn.prepare(
        "SELECT m.id, m.category, m.content, m.source, m.created_at, m.updated_at, bm25(memories_fts)
         FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ?1 ORDER BY bm25(memories_fts) LIMIT ?2",
    )?;
    let hits = stmt
        .query_map(params![query, limit], |r| Ok(MemoryHit { memory: map_row(r)?, score: -r.get::<_, f64>(6)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(hits)
}

/// Make the table match `desired` (category, content) — used when importing `memory.md`.
/// Rows whose (category, content) still exist are kept (ids and dates preserved); others are
/// deleted; new lines are inserted with `source`. Returns (inserted, deleted).
pub fn replace_all(
    conn: &mut Connection,
    desired: &[(MemoryCategory, String)],
    source: &str,
    now: i64,
) -> AppResult<(usize, usize)> {
    let tx = conn.transaction()?;
    let existing = {
        let mut stmt = tx.prepare(&format!("{SELECT} ORDER BY m.created_at, m.rowid"))?;
        stmt.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?
    };
    let mut kept = vec![false; existing.len()];
    let mut to_insert = Vec::new();
    for (category, content) in desired {
        let found = existing
            .iter()
            .enumerate()
            .find(|(i, m)| !kept[*i] && m.category == *category && m.content == *content);
        match found {
            Some((i, _)) => kept[i] = true,
            None => to_insert.push((*category, content.clone())),
        }
    }
    let mut deleted = 0;
    for (m, keep) in existing.iter().zip(&kept) {
        if !keep {
            tx.execute("DELETE FROM memories WHERE id = ?1", [&m.id])?;
            deleted += 1;
        }
    }
    for (offset, (category, content)) in to_insert.iter().enumerate() {
        // Keep the file order for new lines created in the same import.
        let at = now + i64::try_from(offset).unwrap_or(0);
        tx.execute(
            "INSERT INTO memories (id, category, content, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![uuid::Uuid::new_v4().to_string(), category.as_db(), content, source, at],
        )?;
    }
    tx.commit()?;
    Ok((to_insert.len(), deleted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[tokio::test]
    async fn crud_search_and_replace() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            let a = insert(c, MemoryCategory::CodeStyle, "Toujours utiliser des early returns", "user", 1)?;
            insert(c, MemoryCategory::StrictRules, "Ne jamais pousser sur main sans demande", "user", 2)?;
            insert(c, MemoryCategory::Profile, "Développeur Rust et TypeScript", "user", 3)?;
            assert!(insert(c, MemoryCategory::Profile, "   ", "user", 4).is_err());

            let all = list(c)?;
            assert_eq!(all[0].category, MemoryCategory::Profile, "category order");

            let hits = search(c, "pousser main", 10)?;
            assert_eq!(hits.len(), 1);
            assert!(hits[0].memory.content.contains("pousser"));
            assert_eq!(search(c, "typescr", 10)?.len(), 1, "prefix search");
            assert!(search(c, "  ;; ", 10)?.is_empty());

            update(c, &a.id, MemoryCategory::CodeStyle, "Préférer les early returns", 5)?;
            assert_eq!(search(c, "préférer", 5)?.len(), 1, "fts follows updates");

            let desired = vec![
                (MemoryCategory::CodeStyle, "Préférer les early returns".to_string()),
                (MemoryCategory::TechPreferences, "Tokio pour l'async".to_string()),
            ];
            let (ins, del) = replace_all(c, &desired, "file", 10)?;
            assert_eq!((ins, del), (1, 2));
            let after = list(c)?;
            assert_eq!(after.len(), 2);
            assert!(after.iter().any(|m| m.id == a.id), "unchanged line keeps its id");
            assert!(delete(c, &a.id)?);
            Ok(())
        })
        .await
        .unwrap();
    }
}
