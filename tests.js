/* 栄冠ノート 自動テスト（index.html#test で起動）
   file://でも動くように、iframeやfetchに頼らない構成:
   - ロジックテスト: 同一ページ内の関数を直接呼ぶ
   - OCR回帰テスト: tests/cases.json をfetchできればケース一覧、できなければ手動ファイル選択にフォールバック */
(function(){
"use strict";
let started=false; // #testの時だけ起動する（起動処理はファイル末尾）

const R=[]; // [name, pass, msg]
function t(name,fn){
  try{ fn(); R.push([name,true,""]); }
  catch(e){ R.push([name,false,String(e&&e.message||e)]); }
}
function eq(got,exp,msg){
  const sg=JSON.stringify(got), se=JSON.stringify(exp);
  if(sg!==se) throw new Error(`${msg||""} 期待=${se} 実際=${sg}`);
}
function ok(v,msg){ if(!v) throw new Error(msg||"falsyやった"); }
const escT=s=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ---------- ロジックテスト ---------- */
function runLogicTests(){
  R.length=0;
  const T=window.__test;

  t("n: 数値文字列",()=>{ eq(T.n("5"),5); eq(T.n(""),0); eq(T.n("abc"),0); eq(T.n(null),0); });
  t("ip2outs: 整数回",()=>{ eq(ip2outs("9"),27); eq(ip2outs("0"),0); eq(ip2outs(""),0); });
  t("ip2outs: 端数回",()=>{ eq(ip2outs("6.1"),19); eq(ip2outs("0.2"),2); eq(ip2outs("8⅓"),25); eq(ip2outs("2⅔"),8); });
  t("outs2ip: 逆変換",()=>{ eq(outs2ip(27),"9"); eq(outs2ip(19),"6.1"); eq(outs2ip(0),"0"); });
  t("avg3: 表記",()=>{ eq(avg3(0.3333),".333"); eq(avg3(1),"1.000"); eq(avg3(0),".000"); eq(avg3(0/0),"-"); });
  t("nameKey: 正規化",()=>{ eq(nameKey(" 中 村 "),"中村"); eq(nameKey("ﾅｶﾑﾗ"),"ナカムラ"); eq(nameKey("中村②"),"中村2"); });
  t("esc: HTMLエスケープ",()=>{ eq(esc('<a b="c">&'),"&lt;a b=&quot;c&quot;&gt;&amp;"); });
  t("newId: 一意性と型",()=>{
    const s=new Set(); for(let i=0;i<1000;i++) s.add(newId());
    eq(s.size,1000,"1000件で衝突"); ok(typeof newId()==="string","文字列であること");
  });
  t("hasPA: 打席判定",()=>{
    ok(T.hasPA({AB:1,BB:0,SH:0})); ok(T.hasPA({AB:0,BB:1,SH:0})); ok(T.hasPA({AB:0,BB:0,SH:1}));
    ok(!T.hasPA({AB:0,BB:0,SH:0}),"全0は打席なし");
  });
  t("stripColdTag",()=>{
    eq(stripColdTag("甲子園決勝 vs X (コールド)"),{clean:"甲子園決勝 vs X",isCold:true});
    eq(stripColdTag("県予選1回戦"),{clean:"県予選1回戦",isCold:false});
  });
  t("normGame: id保持と型変換",()=>{
    const g=normGame({id:"keep",runsFor:"10",runsAgainst:"9",
      batters:[{name:"A",AB:"4",H:"2"}],pitchers:[{name:"P",IP:"6⅓",K:"5",W:1}]});
    eq(g.id,"keep","既存idが変わった"); eq(g.runsFor,10); eq(g.runsAgainst,9);
    ok(g.runsFor>g.runsAgainst,"数値比較になってない");
    eq(g.batters[0].AB,4); eq(g.pitchers[0].IP,"6.1"); eq(g.pitchers[0].K,5); eq(g.pitchers[0].W,true);
  });
  t("normGame: id無しは自動採番",()=>{ ok(normGame({}).id!=null); });
  t("aggBatting: 集計とOPS",()=>{
    const games=[
      {batters:[{name:"山田",AB:4,H:2,"2B":1,"3B":0,HR:1,R:1,RBI:2,SO:0,BB:0,SH:0,SB:0,GDP:0,E:0}]},
      {batters:[{name:"山田",AB:3,H:1,"2B":0,"3B":0,HR:0,R:0,RBI:0,SO:1,BB:1,SH:0,SB:0,GDP:0,E:0}]}
    ];
    const r=aggBatting(games)[0];
    eq(r.G,2); eq(r.AB,7); eq(r.H,3); eq(r.TB,7,"塁打=H+2B+2*3B+3*HR");
    eq(Math.round(r.AVG*1000),429); eq(Math.round(r.OBP*1000),500);
    eq(Math.round(r.OPS*1000),1500,"OPS=OBP+SLG");
  });
  t("aggPitching: 投球回合算とERA",()=>{
    const games=[
      {pitchers:[{name:"P",IP:"6.1",BF:25,H:5,K:7,BB:2,R:2,ER:2,WP:0,HR:0,W:true}]},
      {pitchers:[{name:"P",IP:"2.2",BF:10,H:1,K:3,BB:0,R:1,ER:1,WP:0,HR:0,W:false}]}
    ];
    const r=aggPitching(games)[0];
    eq(r.outs,27); eq(r.IPstr,"9"); eq(r.W,1); eq(r.K,10);
    eq(r.ERA.toFixed(2),"3.00");
  });
  t("teamTotals: 勝敗と得失点",()=>{
    const T2=teamTotals([
      {runsFor:5,runsAgainst:3,batters:[]},
      {runsFor:2,runsAgainst:2,batters:[]},
      {runsFor:0,runsAgainst:1,batters:[]}
    ]);
    eq([T2.W,T2.L,T2.D],[1,1,1]); eq([T2.RF,T2.RA],[7,6]);
  });
  t("gradeInfo: 学年と引退判定",()=>{
    eq(gradeInfo(2031,"2031夏県予選",2031).label,"1年");
    eq(gradeInfo(2031,"2033夏甲子園",2033),{label:"3年",retired:false},"夏甲子園までは現役");
    eq(gradeInfo(2031,"2033秋県予選・地区大会",2033).label,"引退","夏の後は引退");
    eq(gradeInfo(2031,"2034春甲子園",2034).label,"引退","春センバツは前年度扱いで3年引退");
    eq(gradeInfo(2031,"2034夏県予選",2034).label,"卒業");
    eq(gradeInfo(null,"2031夏県予選",2031).label,"","入学年未設定");
  });
  t("periodYearOf: 年度区切り（4月始まり）",()=>{
    eq(periodYearOf({date:"2032-03-15"}),2031,"1〜3月は前年度");
    eq(periodYearOf({date:"2032-04-01"}),2032);
    eq(periodYearOf({date:""}),null);
  });
  t("seasonYearOf",()=>{ eq(seasonYearOf("2032夏県予選",null),2032); eq(seasonYearOf("練習試合",[{date:"2031-05-01"}]),2031); });
  t("parseOpponentForSeason: ラウンド分解",()=>{
    const p=parseOpponentForSeason("2032夏県予選","県予選決勝 vs 田沢");
    eq([p.round,p.name],["7","田沢"]);
    const q=parseOpponentForSeason("2032夏県予選","ただの相手名");
    eq([q.round,q.name],["","ただの相手名"]);
  });
  t("sortRows",()=>{
    const rows=[{a:1,b:"い"},{a:3,b:"あ"},{a:2,b:"う"}];
    eq(sortRows(rows,"a",-1).map(r=>r.a),[3,2,1],"数値降順");
    eq(sortRows(rows,"b",1).map(r=>r.b),["あ","い","う"],"文字列昇順");
    eq(sortRows(rows,null,1),rows,"key無しはそのまま");
  });
  t("findGameById / mergeDB / uniqueRegName（DB差し替え）",()=>{
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S1":{games:[{id:"a"},{id:2}]}},current:"S1",
        playerMeta:{[nameKey("中村")]:{enrollYear:2030},[nameKey("中村②")]:{name:"中村②"}}});
      eq(findGameById("a").season,"S1");
      eq(findGameById(2).season,"S1","数値idも文字列比較で発見");
      eq(findGameById("zzz"),null);
      eq(uniqueRegName("中村"),"中村③","②が居るので③");
      eq(uniqueRegName("高橋"),"高橋");
      const r=mergeDB({seasons:{
        "S1":{games:[{id:"a"},{id:"c"}]},
        "S2":{games:[{id:"d"}]},
        "空":{games:[]}
      },playerMeta:{[nameKey("中村")]:{enrollYear:2029,position:"捕手"},[nameKey("新人")]:{name:"新人",enrollYear:2033}}});
      eq(r.totalAdded,2,"新規2試合のみ追加");
      const db=T.getDB();
      eq(db.seasons["S1"].games.length,3); eq(db.seasons["S2"].games.length,1);
      ok(!db.seasons["空"],"空シーズンは作らない");
      eq(db.playerMeta[nameKey("中村")].enrollYear,2030,"既存値は上書きしない");
      eq(db.playerMeta[nameKey("中村")].position,"捕手","未設定項目は補完");
      eq(db.playerMeta[nameKey("新人")].name,"新人");
      eq(mergeDB({seasons:{"S1":{games:[{id:"a"},{id:"c"}]}}}).totalAdded,0,"再マージは追加ゼロ（冪等）");
    }finally{
      T.setDB(real); // 実データに戻す（saveDBは呼んでいないので保存はされない）
    }
  });

  const el=panel.querySelector("#tLogicResults");
  el.innerHTML=R.map(([name,pass,msg])=>
    `<div class="trow"><span class="${pass?'tpass':'tfail'}">${pass?'✅':'❌'}</span> ${escT(name)}${pass?'':`<pre>${escT(msg)}</pre>`}</div>`).join("");
  const passCnt=R.filter(r=>r[1]).length;
  const sum=panel.querySelector("#tLogicSummary");
  sum.textContent=`${passCnt} / ${R.length} 件パス`;
  sum.className="tsummary "+(passCnt===R.length?"tpass":"tfail");
}

/* ---------- OCR回帰テスト ---------- */
let OCR_CASES=[];
function gemCfg(){
  const keyInput=document.getElementById("gemKey");
  const key=(keyInput&&keyInput.value.trim()) || localStorage.getItem("eikan-gemkey") || "";
  const modelInput=document.getElementById("gemModel");
  const model=(modelInput&&modelInput.value.trim()) || localStorage.getItem("eikan-gemmodel") || window.__test.DEF_MODEL;
  return {key,model};
}
async function loadCases(){
  const cfgEl=panel.querySelector("#tOcrCfg");
  const {key,model}=gemCfg();
  if(!key){
    cfgEl.textContent="⚠ APIキー未設定。先に「試合を追加」タブで設定してな。";
  }else{
    cfgEl.innerHTML=`モデル: <select id="tModelSel" style="max-width:260px"></select> <button id="tModelReload">一覧取得</button>`;
    const appSel=document.getElementById("gemModel");
    const fill=()=>{
      const t=panel.querySelector("#tModelSel");
      t.innerHTML=(appSel&&appSel.innerHTML)||`<option>${escT(model)}</option>`;
      if(appSel&&appSel.value) t.value=appSel.value;
    };
    fill();
    panel.querySelector("#tModelSel").addEventListener("change",e=>{
      if(appSel){ appSel.value=e.target.value; }
      try{ saveGemCfg(); }catch(_){}
    });
    panel.querySelector("#tModelReload").addEventListener("click",async()=>{
      try{ await loadModels(true); }catch(_){}
      fill();
    });
  }
  let listHtml="";
  try{
    OCR_CASES=await (await fetch("tests/cases.json")).json();
    listHtml=OCR_CASES.map((c,i)=>`<label class="tcase"><input type="checkbox" data-i="${i}" checked> ${escT(c.name)}</label>`).join("")
      +`<div style="margin-top:8px"><button id="tRunOcr">選択したケースを実行</button></div>`;
  }catch(e){
    listHtml=`<div class="tnote">tests/cases.json が読めへんかった（file://で開いてる場合は下の手動実行を使ってな）</div>`;
  }
  listHtml+=`<div class="tmanual">
    <div class="tnote" style="margin-top:12px">手動実行（file://対応）: スクショと期待JSONを選んで実行</div>
    <div>画像: <input type="file" id="tManImgs" accept="image/*" multiple></div>
    <div>期待JSON: <input type="file" id="tManExp" accept=".json"></div>
    <div style="margin-top:6px"><button id="tRunManual">手動ケースを実行</button></div>
  </div><div id="tOcrResults"></div>`;
  panel.querySelector("#tOcrBody").innerHTML=listHtml;
  const runBtn=panel.querySelector("#tRunOcr");
  if(runBtn) runBtn.addEventListener("click",runSelectedCases);
  panel.querySelector("#tRunManual").addEventListener("click",runManualCase);
}
function cmpGame(exp,got,log){
  let bad=0;
  const chk=(cond,msg)=>{ if(!cond){bad++;log("✗ "+msg);} };
  for(const k of ["date","runsFor","runsAgainst"])
    chk(JSON.stringify(exp[k])===JSON.stringify(got[k]),`${k}: 期待${JSON.stringify(exp[k])} 実際${JSON.stringify(got[k])}`);
  let gotCold=!!got.cold;
  const inn=got.innings;
  if(inn && Array.isArray(inn.top) && (inn.top.length || (Array.isArray(inn.bottom)&&inn.bottom.length)))
    gotCold = inn.top.length < 9; // アプリ本体と同じinnings機械判定を適用して比較
  chk(!!exp.cold===gotCold,`cold: 期待${!!exp.cold} 実際${gotCold}（innings判定適用後）`);
  for(const k of Object.keys(exp.batTotals||{}))
    chk((+(exp.batTotals[k]||0))===(+((got.batTotals||{})[k]||0)),`合計${k}: 期待${exp.batTotals[k]||0} 実際${(got.batTotals||{})[k]||0}`);
  const bkeys=["AB","R","H","2B","3B","HR","RBI","SO","BB","SH","SB","GDP","E"];
  const gb=new Map((got.batters||[]).map(b=>[nameKey(b.name),b]));
  for(const eb of (exp.batters||[])){
    const b=gb.get(nameKey(eb.name));
    if(!b){ bad++; log(`✗ 打者「${eb.name}」が出力に無い`); continue; }
    gb.delete(nameKey(eb.name));
    for(const k of bkeys) chk((+(eb[k]||0))===(+(b[k]||0)),`${eb.name}.${k}: 期待${eb[k]||0} 実際${b[k]||0}`);
  }
  for(const [,b] of gb){ bad++; log(`✗ 余分な打者「${b.name}」`); }
  const gp=new Map((got.pitchers||[]).map(p=>[nameKey(p.name),p]));
  for(const ep of (exp.pitchers||[])){
    const p=gp.get(nameKey(ep.name));
    if(!p){ bad++; log(`✗ 投手「${ep.name}」が出力に無い`); continue; }
    gp.delete(nameKey(ep.name));
    chk(String(ep.IP)===String(p.IP),`${ep.name}.IP: 期待${ep.IP} 実際${p.IP}`);
    chk(!!ep.W===!!p.W,`${ep.name}.W: 期待${!!ep.W} 実際${!!p.W}`);
    for(const k of ["BF","H","K","BB","R","ER","WP","HR"])
      chk((+(ep[k]||0))===(+(p[k]||0)),`${ep.name}.${k}: 期待${ep[k]||0} 実際${p[k]||0}`);
  }
  for(const [,p] of gp){ bad++; log(`✗ 余分な投手「${p.name}」`); }
  const os=a=>(a||[]).map(o=>`${o.pos}:${nameKey(o.name)}:${o.sub?1:0}`).sort().join(" | ");
  if(os(exp.order)!==os(got.order)){ bad++; log(`✗ 打順不一致\n  期待: ${os(exp.order)}\n  実際: ${os(got.order)}`); }
  return bad;
}
function blobToB64(blob){
  return new Promise((ok,ng)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(",")[1]);r.onerror=ng;r.readAsDataURL(blob);});
}
async function ocrRun(imageBlobs,expected,box){
  const {key,model}=gemCfg();
  if(!key){ box.innerHTML='<span class="tfail">APIキー未設定</span>'; return; }
  const parts=[{text:window.__test.OCR_PROMPT}];
  for(const b of imageBlobs) parts.push({inline_data:{mime_type:b.type||"image/png",data:await blobToB64(b)}});
  box.innerHTML='<span class="tspin"></span>Geminiで解析中…';
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const opts={method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{parts}],generationConfig:{temperature:0}})};
  const resp = (typeof gemFetch==="function")
    ? await gemFetch(url,opts,(n,w)=>{box.innerHTML=`<span class="tspin"></span>混雑中(503/429)… ${w/1000}秒待ってリトライ ${n}/2`;})
    : await fetch(url,opts);
  if(!resp.ok) throw new Error("API "+resp.status+": "+(await resp.text()).slice(0,150));
  const data=await resp.json();
  let txt=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
  const fences=[...txt.matchAll(/```(?:json)?([\s\S]*?)```/g)];
  if(fences.length) txt=fences[fences.length-1][1];
  else { const s=txt.indexOf("{"), e=txt.lastIndexOf("}"); if(s>=0&&e>s) txt=txt.slice(s,e+1); }
  const got=JSON.parse(txt.trim());
  const logs=[];
  const bad=cmpGame(expected,got,m=>logs.push(m));
  box.innerHTML = bad===0
    ? `<span class="tpass">✅ 全項目一致</span>`
    : `<span class="tfail">❌ 不一致 ${bad}件</span><pre>${escT(logs.join("\n"))}</pre>`;
}
async function runSelectedCases(){
  const checks=[...panel.querySelectorAll("#tOcrBody input[type=checkbox]:checked")];
  const out=panel.querySelector("#tOcrResults"); out.innerHTML="";
  for(const ch of checks){
    const c=OCR_CASES[parseInt(ch.dataset.i,10)];
    const box=document.createElement("div"); box.className="tcasebox";
    box.innerHTML=`<b>${escT(c.name)}</b><div class="tbody"><span class="tspin"></span>画像読み込み中…</div>`;
    out.appendChild(box);
    const body=box.querySelector(".tbody");
    try{
      const blobs=[];
      for(const path of c.images){
        const res=await fetch(path);
        if(!res.ok) throw new Error(`画像が読めへん: ${path}（tests/フォルダに配置した？）`);
        blobs.push(await res.blob());
      }
      const expected=await (await fetch(c.expected)).json();
      await ocrRun(blobs,expected,body);
    }catch(e){ body.innerHTML=`<span class="tfail">エラー: ${escT(String(e.message||e))}</span>`; }
  }
}
async function runManualCase(){
  const imgs=[...panel.querySelector("#tManImgs").files].sort((a,b)=>a.name.localeCompare(b.name));
  const expF=panel.querySelector("#tManExp").files[0];
  const out=panel.querySelector("#tOcrResults"); out.innerHTML="";
  const box=document.createElement("div"); box.className="tcasebox";
  box.innerHTML=`<b>手動ケース</b><div class="tbody"></div>`;
  out.appendChild(box);
  const body=box.querySelector(".tbody");
  if(!imgs.length||!expF){ body.innerHTML='<span class="tfail">画像と期待JSONの両方を選んでな</span>'; return; }
  try{
    const expected=JSON.parse(await expF.text());
    await ocrRun(imgs,expected,body);
  }catch(e){ body.innerHTML=`<span class="tfail">エラー: ${escT(String(e.message||e))}</span>`; }
}

/* ---------- パネルUI ---------- */
let panel=null;
function buildPanel(){
  const st=document.createElement("style");
  st.textContent=`
    #testPanel{position:fixed;inset:0;z-index:999;background:#0b1a2bee;overflow-y:auto;padding:20px 14px;color:#eef5fb;font-size:14px;}
    #testPanel .twrap{max-width:900px;margin:0 auto;}
    #testPanel h1{font-size:19px;border-bottom:2px solid #f5b301;padding-bottom:8px;display:flex;align-items:center;gap:10px;}
    #testPanel h2{font-size:15px;margin-top:24px;}
    #testPanel .tnote{color:#7ea6c9;font-size:12px;line-height:1.6;}
    #testPanel .trow{padding:3px 0;border-bottom:1px solid #16324a;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;}
    #testPanel .tpass{color:#38c46b;} #testPanel .tfail{color:#e5484d;font-weight:700;}
    #testPanel .tsummary{font-size:15px;font-weight:700;margin:10px 0;}
    #testPanel pre{background:#0d2033;padding:8px;border-radius:8px;overflow-x:auto;font-size:12px;white-space:pre-wrap;}
    #testPanel .tcase{display:flex;gap:6px;align-items:center;padding:4px 0;cursor:pointer;}
    #testPanel .tcasebox{background:#12293f;border:1px solid #22425f;border-radius:10px;padding:10px 14px;margin:8px 0;}
    #testPanel .tmanual{border-top:1px dashed #22425f;margin-top:10px;padding-top:4px;}
    #testPanel .tmanual div{margin:4px 0;}
    #testPanel .tspin{display:inline-block;width:13px;height:13px;border:2px solid #7ea6c9;border-top-color:#f5b301;border-radius:50%;animation:tsp .7s linear infinite;vertical-align:-2px;margin-right:6px;}
    @keyframes tsp{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(st);
  panel=document.createElement("div");
  panel.id="testPanel";
  panel.innerHTML=`<div class="twrap">
    <h1>⚾ 自動テスト <button class="mini ghost" id="tClose">閉じる</button> <button class="mini ghost" id="tRerun">再実行</button></h1>
    <div class="tnote">アプリ本体と同じページ内で実行。データの保存は行わない。</div>
    <h2>ロジックテスト</h2>
    <div id="tLogicSummary" class="tsummary"></div>
    <div id="tLogicResults"></div>
    <h2>OCR回帰テスト <span class="tnote">（1ケースごとにGemini API消費あり・出力が揺らぐことがある）</span></h2>
    <div id="tOcrCfg" class="tnote" style="margin:6px 0"></div>
    <div id="tOcrBody"></div>
  </div>`;
  document.body.appendChild(panel);
  panel.querySelector("#tClose").addEventListener("click",()=>{
    panel.remove(); st.remove();
    started=false; // もう一度#testを付ければ再起動できるように
    history.replaceState(null,"",location.pathname+"#summary");
  });
  panel.querySelector("#tRerun").addEventListener("click",runLogicTests);
}

/* ---------- 起動（アプリのinit完了を待つ） ---------- */
async function boot(){
  for(let i=0;i<100;i++){
    if(window.__test && window.__test.getDB()) break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!(window.__test && window.__test.getDB())){
    alert("テスト起動失敗: アプリの初期化を検出できへんかった");
    started=false;
    return;
  }
  buildPanel();
  runLogicTests();
  await loadCases();
}
function activate(){
  if(started) return;
  started=true;
  boot();
}
// 読み込み時に#test、または後からアドレスバーで#testを付けた時に起動
if(location.hash==="#test" || /[?&]test\b/.test(location.search)) activate();
window.addEventListener("hashchange",()=>{ if(location.hash==="#test") activate(); });
})();
