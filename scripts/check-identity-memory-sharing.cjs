// Synthetic IndexedDB records only. No user data, credentials, model calls, or network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { indexedDB } = require('fake-indexeddb');
function load(file, dependencies, globals = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: name => {
        assert(name in dependencies, `Missing test dependency: ${name}`); return dependencies[name];
    }, console, setTimeout, clearTimeout, Event, indexedDB, ...globals });
    return exports;
}
const core = load('lib/identity-space.ts', {});
const settings = new Map();
let state = {version:1,activeUserId:'A',legacyOwnerId:'A',userIds:['A','B','C','D'],deletingUserIds:['D'],revision:0};
let currentId = 'A', revision = 0;
let access = {char:['A','B']};
const profiles = [{id:'A',name:'Zoe',bio:'咖啡',occupation:'学生'},{id:'B',name:'Mia',bio:'茶'},{id:'C',name:'Excluded'},{id:'D',name:'Deleting'}];
let readHook, reads = 0;
const trackedIndexedDB = { open(name) { reads++; readHook?.(); return indexedDB.open(name); } };
const runtime = {
    assertIdentityActive() { if(state.activeUserId!==currentId || state.revision!==revision) throw new core.IdentityBoundaryError(); },
    getCurrentIdentityId: () => currentId, readIdentityRuntime: () => state,
};
const sharing = load('lib/identity-memory-sharing.ts', {
    './kv-db':{kvGet:key=>settings.get(key),kvSet:(key,value)=>settings.set(key,value)},
    './settings-storage':{loadUserIdentities:()=>profiles},
    './identity-access':{loadCharacterIdentityAccess:()=>access},
    './identity-space':core, './identity-runtime':runtime,
}, {indexedDB:trackedIndexedDB,window:{dispatchEvent(){}}});
async function seed(name, stores) {
    const db = await new Promise((resolve,reject)=>{
        const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{
            for(const [storeName,{indexes=[]}] of Object.entries(stores)) {
                const s=r.result.createObjectStore(storeName,{keyPath:'id'});
                for(const [index,key] of indexes)s.createIndex(index,key);
            }
        };r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);
    });
    await new Promise((resolve,reject)=>{const t=db.transaction(Object.keys(stores),'readwrite');
        for(const [name,{rows}] of Object.entries(stores))for(const row of rows)t.objectStore(name).put(row);
        t.oncomplete=resolve;t.onerror=()=>reject(t.error);
    });db.close();
}
const memory=(id,content,type='long_term')=>({id,characterId:'char',sourceApp:'chat',type,content,importance:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
async function main() {
    for(const [owner,name] of [['A','ai_phone_memory_db_v1'],['B','ai_phone_memory_db_v1::identity:B'],['C','ai_phone_memory_db_v1::identity:C'],['D','ai_phone_memory_db_v1::identity:D']]) {
        await seed(name,{memories:{indexes:[['by_character','characterId']],rows:[memory('same-id',`${owner} 的用户喜欢 ${owner==='A'?'咖啡':'茶'}`),memory('core',`${owner} 的关系承诺`,'core'),{...memory('unrelated','另一个角色的秘密'),characterId:'other'}]}});
    }
    const msg=(id,sessionId,role,content,extra={})=>({id,sessionId,role,content,status:'sent',createdAt:'2026-01-02T00:00:00Z',...extra});
    await seed('AiPhoneChatDB::identity:B',{
        contacts:{rows:[{id:'contactB',characterId:'char'},{id:'otherContact',characterId:'other'}]},
        sessions:{rows:[{id:'direct',contactId:'contactB'},{id:'group',contactId:'contactB',isGroup:true},{id:'other',contactId:'otherContact'}]},
        messages:{indexes:[['createdAt','createdAt']],rows:[
            msg('b1','direct','user','我和你去过波士顿'),msg('b2','direct','assistant','记得和 Mia 一起去'),
            msg('tool','direct','tool','不能读取的工具指令'),msg('withdrawn','direct','user','撤回内容',{isRetracted:true}),
            msg('failed','direct','user','未发送内容',{status:'failed'}),msg('group','group','user','群聊不应读到'),
            msg('other','other','user','另一角色的对话'),
        ]},
    });
    assert.equal(sharing.isCharacterMemoryShared('char'),false);
    assert.equal((await sharing.loadOtherIdentityMemories('char','long_term')).length,0);
    assert.equal(reads,0,'default off must not open peer databases');
    sharing.setCharacterMemoryShared('char',true);
    const records=await sharing.loadOtherIdentityMemories('char','long_term');
    assert.equal(records.length,3);
    assert(records.every(m=>m.metadata.sourceIdentityId==='B'&&m.content.includes('ID="B"')));
    assert(records.some(m=>m.content.includes('用户喜欢 茶')));
    assert(records.some(m=>m.content.includes('说话者=身份 "Mia"')));
    assert(!records.some(m=>/另一角色|群聊不应|撤回内容|工具指令|未发送/.test(m.content)));
    assert.equal((await sharing.loadOtherIdentityMemories('char','core')).length,1);
    assert.equal((await sharing.loadOtherIdentityMemories('char','long_term',false)).length,1);
    const prompt=sharing.buildIdentityMemoryContext('char');
    assert(prompt.includes('当前唯一正在与你对话的用户是 身份 "Zoe"（ID="A"）'));
    assert(prompt.includes('Mia')&&!prompt.includes('Excluded')&&!prompt.includes('Deleting'));
    profiles[1].name='Zoe';assert(sharing.identityMemoryAttribution('B').includes('ID="B"'));profiles[1].name='Mia';
    // No source mutation, including legacy records without owner metadata.
    const db=await new Promise(resolve=>{const r=indexedDB.open('ai_phone_memory_db_v1::identity:B');r.onsuccess=()=>resolve(r.result)});
    const original=await new Promise(resolve=>{const r=db.transaction('memories').objectStore('memories').get('same-id');r.onsuccess=()=>resolve(r.result)});db.close();
    assert.equal(original.metadata,undefined);assert.equal(original.content,'B 的用户喜欢 茶');
    // B can remember A from the old unprefixed namespace, with identical source IDs kept distinct.
    currentId='B';state.activeUserId='B';
    const fromA=await sharing.loadOtherIdentityMemories('char','long_term');
    assert.equal(fromA.length,1);assert.equal(fromA[0].metadata.sourceIdentityId,'A');
    currentId='A';state.activeUserId='A';
    const service=load('lib/memory-service.ts',{
        './memory-storage':{loadMemoryEntriesByType:async(_id,type)=>[memory('same-id','用户喜欢咖啡',type)]},
        './settings-storage':{resolveAuxiliaryApiConfig:()=>null},
        './memory-embedding':{},'./token-counter':{estimateTokens:text=>text.length},
        './identity-memory-sharing':sharing,'./identity-runtime':runtime,
    });
    const recalled=await service.retrieveMemoriesForPrompt('char','你记得谁喜欢什么吗',{longTermTokenBudget:20000});
    assert(recalled.some(m=>m.content.includes('ID="A"')&&m.content.includes('咖啡')));
    assert(recalled.some(m=>m.content.includes('ID="B"')&&m.content.includes('茶')));
    // Permission revoked while an IndexedDB read is in flight.
    readHook=()=>{access={char:['A']};readHook=null};
    assert.equal((await sharing.loadOtherIdentityMemories('char','long_term')).length,0);
    access={char:['A','B']};
    readHook=()=>{state={...state,activeUserId:'B',revision:1};readHook=null};
    await assert.rejects(sharing.loadOtherIdentityMemories('char','long_term'),/身份已切换/);
    state={...state,activeUserId:'A',revision:0};
    // Missing DB is not created by opt-in recall.
    access={char:[]};state.deletingUserIds=[];
    await sharing.loadOtherIdentityMemories('char','long_term');
    const databases=await indexedDB.databases();
    assert(!databases.some(db=>db.name==='AiPhoneChatDB::identity:C'));
    sharing.setCharacterMemoryShared('char',false);
    assert.equal(sharing.buildIdentityMemoryContext('char'),'');
    assert.equal((await sharing.loadOtherIdentityMemories('char','core')).length,0);
    console.log('PASS: default-off, legacy and A/B namespaces, same-name/ID attribution, core + long-term + recent chat recall, no source mutation, unrelated/group/retracted/failed/tool exclusion, source toggle, denied/deleting identities, mid-read revoke/switch, missing DB and disable.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
