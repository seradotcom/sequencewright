//! Canonical Host-mediated native integration. The app owns the database and CAS.
use semwright_native_sdk::cooperation::{Application, CancellationSemantics, CommitSemantics,
    OperationContract, RetrySemantics, TargetRequirement, UndoSemantics};
use semwright_native_sdk::process_bridge::{NodeBridge, NodeBridgeConfig};
use semwright_native_sdk::{CommandDescriptor, Idempotency, NativeDriver, Result, Risk, json, serve};
use std::time::Duration;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Spec { name: String, mutation: bool, input: serde_json::Value }

fn contracts() -> std::result::Result<Vec<OperationContract>, Box<dyn std::error::Error>> {
    let specs: Vec<Spec> = serde_json::from_str(include_str!("../../contracts/native-operations.json"))?;
    Ok(specs.into_iter().map(|s| OperationContract {
        descriptor: CommandDescriptor {
            description: format!("{} through application-owned revision and transaction boundaries", s.name),
            name: s.name,
            version: env!("CARGO_PKG_VERSION").into(),
            input_schema: s.input,
            output_schema: json!({"type":"object"}),
            requires: vec!["driver:sequencewright".into()],
            backends: vec!["driver:sequencewright".into()],
            risk: if s.mutation { Risk::Mutating } else { Risk::ReadOnly },
            idempotency: if s.mutation { Idempotency::Idempotent } else { Idempotency::ReadOnly },
            timeout_ms: 10_000, dry_run: false, interactive_consent: false,
        },
        target: TargetRequirement::ObservedResource,
        commit: if s.mutation { CommitSemantics::ApplicationTransaction } else { CommitSemantics::ReadOnly },
        retry: if s.mutation { RetrySemantics::DurableRequestKey } else { RetrySemantics::StateIdempotent },
        undo: UndoSemantics::None,
        cancellation: CancellationSemantics::BeforeEffects,
        atomic_revision_cas: s.mutation,
    }).collect())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let digest = option_env!("SEQUENCEWRIGHT_NATIVE_BUNDLE_SHA256").ok_or_else(||
        semwright_native_sdk::Error::invalid("Build with the SHA-256 of dist/sequencewright.cjs"))?;
    let bridge = NodeBridge::new(NodeBridgeConfig {
        tool: "node".into(), bundle_mount: "native-runtime".into(),
        bundle_file: "sequencewright.cjs".into(), bundle_sha256: digest.into(),
        data_mount: "sequencewright-data".into(), output_mount: None,
        timeout: Duration::from_secs(8),
    })?;
    let mut app = Application::new("sequencewright", env!("CARGO_PKG_VERSION"))?
        .require_host_tools().with_observer(bridge.clone()).with_recovery(bridge.clone());
    let specs = contracts().map_err(|_| semwright_native_sdk::Error::invalid("Invalid built-in operation contracts"))?;
    for contract in specs {
        let command = contract.descriptor.name.clone();
        app = app.register(contract, bridge.operation(command))?;
    }
    serve(NativeDriver::new(app)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_application_accepts_all_operation_contracts() {
        let specs = contracts().expect("valid JSON");
        assert_eq!(specs.len(), 37);
        let bridge = NodeBridge::new(NodeBridgeConfig {
            tool: "node".into(), bundle_mount: "native-runtime".into(),
            bundle_file: "sequencewright.cjs".into(), bundle_sha256: "a".repeat(64),
            data_mount: "sequencewright-data".into(), output_mount: None,
            timeout: Duration::from_secs(8),
        }).expect("bridge config");
        let mut app = Application::new("sequencewright", "0.1.0").expect("app");
        for contract in specs {
            let name = contract.descriptor.name.clone();
            app = app.register(contract, bridge.operation(name)).expect("canonical contract validation");
        }
    }
}
