//! Bounded typed input only. No generated source code, shell or custom temporal solver.
use semwright_motion_authoring::{Film, realize};
use semwright_semantic_composition::canonical_digest;
use std::io::{self, Read};
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    io::stdin().take(2_000_001).read_to_end(&mut bytes)?;
    if bytes.len() > 2_000_000 { return Err("Film exceeds compiler input budget".into()); }
    let film: Film = serde_json::from_slice(&bytes)?;
    let result = realize(&film)?;
    println!("{}", serde_json::to_string(&serde_json::json!({
        "schema":"sequencewright/compilation/1",
        "sdk_revision":"4d291de26724810017ce7b6d185326514cb79fa6",
        "film_digest":canonical_digest(&film)?,
        "realization_digest":canonical_digest(&result)?,
        "realization":result,
        "coverage":"canonical Film validation and deterministic realization; no native pixels or audio",
        "render_status":"NOT_RUN"
    }))?);
    Ok(())
}
fn main() { if let Err(e) = run() { eprintln!("{e}"); std::process::exit(1); } }
