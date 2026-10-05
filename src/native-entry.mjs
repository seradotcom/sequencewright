import {bridgeEntrypoint} from '../vendor/semwright-native-sdk/index.mjs';
import {Store} from './store.mjs';
import {READS} from './contracts.mjs';
/** Name and export shape are mandated by canonical NodeBridge, not a custom IPC. */
export async function semwrightNativeBridgeMain(raw){
 const readOperation=raw?.method==='invoke'&&READS.includes(raw?.operation);
 return bridgeEntrypoint((paths,readOnly)=>new Store(paths.data_root,{readOnly:readOnly||readOperation,actor:'semwright-agent'}).application())(raw);
}
