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
function ok(v,msg){ if(!v) throw new Error(msg||"falsyでした"); }
const escT=s=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ---------- ロジックテスト ---------- */
function runLogicTests(){
  R.length=0;
  const T=window.__test;


  t("基本ヘルパー（数値・名前・ID・エスケープ）",()=>{
    { eq(T.n("5"),5); eq(T.n(""),0); eq(T.n("abc"),0); eq(T.n(null),0); }
    { eq(ip2outs("9"),27); eq(ip2outs("0"),0); eq(ip2outs(""),0); }
    { eq(ip2outs("6.1"),19); eq(ip2outs("0.2"),2); eq(ip2outs("8⅓"),25); eq(ip2outs("2⅔"),8); }
    { eq(ip2outs("8 1/3"),25); eq(ip2outs("8 2/3"),26); eq(ip2outs("1/3"),1); eq(ip2outs("8と2/3"),26); }
    { eq(outs2ip(27),"9"); eq(outs2ip(19),"6.1"); eq(outs2ip(0),"0"); }
    { eq(avg3(0.3333),".333"); eq(avg3(1),"1.000"); eq(avg3(0),".000"); eq(avg3(0/0),"-"); }
    { eq(nameKey(" 中 村 "),"中村"); eq(nameKey("ﾅｶﾑﾗ"),"ナカムラ"); eq(nameKey("中村②"),"中村2"); }
    { eq(esc('<a b="c">&'),"&lt;a b=&quot;c&quot;&gt;&amp;"); }
    {
    const s=new Set(); for(let i=0;i<1000;i++) s.add(newId());
    eq(s.size,1000,"1000件で衝突"); ok(typeof newId()==="string","文字列であること");
  }
    {
    ok(T.hasPA({AB:1,BB:0,SH:0})); ok(T.hasPA({AB:0,BB:1,SH:0})); ok(T.hasPA({AB:0,BB:0,SH:1}));
    ok(!T.hasPA({AB:0,BB:0,SH:0}),"全0は打席なし");
  }
    {
    eq(stripColdTag("甲子園決勝 vs X (コールド)"),{clean:"甲子園決勝 vs X",isCold:true});
    eq(stripColdTag("県予選1回戦"),{clean:"県予選1回戦",isCold:false});
  }
  });

  t("入力の正規化・JSON解析",()=>{
    {
    const g=normGame({id:"keep",runsFor:"10",runsAgainst:"9",
      batters:[{name:"A",AB:"4",H:"2"}],pitchers:[{name:"P",IP:"6⅓",K:"5",W:1}]});
    eq(g.id,"keep","既存idが変わった"); eq(g.runsFor,10); eq(g.runsAgainst,9);
    ok(g.runsFor>g.runsAgainst,"数値比較になってない");
    eq(g.batters[0].AB,4); eq(g.pitchers[0].IP,"6.1"); eq(g.pitchers[0].K,5); eq(g.pitchers[0].W,true);
  }
    { ok(normGame({}).id!=null); }
    {
    const g=normGame({batters:"bad",pitchers:{x:1},innings:{top:"1",bottom:[0,1]},badges:"x"});
    eq(g.batters,[]); eq(g.pitchers,[]); eq(g.innings.top,[]); eq(g.innings.bottom,[0,1]); eq(g.badges,[]);
  }
    {
    const text='説明文\n```json\n{"date":"2031-08-21","runsFor":3,"runsAgainst":2,}\n```';
    const parsed=extractJsonPayload(text);
    eq(parsed.date,"2031-08-21"); eq(parsed.runsFor,3); eq(parsed.runsAgainst,2);
  }
    {
    const withFence='前置き\n```json\n{"date":"2031-08-21","runsFor":3}\n```\n後置き';
    eq(T.parseOcrJson(withFence),{date:"2031-08-21",runsFor:3},"jsonフェンスから抽出");
    const raw='ノイズ {"runsFor":5,"runsAgainst":2} 末尾ノイズ';
    eq(T.parseOcrJson(raw),{runsFor:5,runsAgainst:2},"フェンス無しは最初と最後の波括弧で抽出");
  }
    {
    // 第101弾: 1行だけで分かる矛盾（OCRハイブリッド検算の確信度ハイライト）
    const RC=T.rowContradiction;
    ok(RC({AB:3,H:4}),"安打>打数は矛盾");
    ok(RC({AB:4,H:2,"2B":1,"3B":1,HR:1}),"長打合計(3)>安打(2)は矛盾");
    ok(!RC({AB:4,H:2,"2B":1,"3B":0,HR:1}),"長打合計(2)≦安打(2)は正常");
    ok(!RC({AB:0,H:0}),"全0は矛盾なし");
    ok(!RC({AB:4,H:4,"2B":0,"3B":0,HR:0}),"全打席安打でも打数以内なら正常");
    ok(RC({AB:"1",H:"3"}),"文字列でも数値として判定");
  }
  });

  t("集計の基本（打撃・投球・チーム・並べ替え）",()=>{
    {
    const games=[
      {batters:[{name:"山田",AB:4,H:2,"2B":1,"3B":0,HR:1,R:1,RBI:2,SO:0,BB:0,SH:0,SB:0,GDP:0,E:0}]},
      {batters:[{name:"山田",AB:3,H:1,"2B":0,"3B":0,HR:0,R:0,RBI:0,SO:1,BB:1,SH:0,SB:0,GDP:0,E:0}]}
    ];
    const r=aggBatting(games)[0];
    eq(r.G,2); eq(r.AB,7); eq(r.H,3); eq(r.TB,7,"塁打=H+2B+2*3B+3*HR");
    eq(Math.round(r.AVG*1000),429); eq(Math.round(r.OBP*1000),500);
    eq(Math.round(r.OPS*1000),1500,"OPS=OBP+SLG");
  }
    {
    const games=[
      {pitchers:[{name:"P",IP:"6.1",BF:25,H:5,K:7,BB:2,R:2,ER:2,WP:0,HR:0,W:true}]},
      {pitchers:[{name:"P",IP:"2.2",BF:10,H:1,K:3,BB:0,R:1,ER:1,WP:0,HR:0,W:false}]}
    ];
    const r=aggPitching(games)[0];
    eq(r.outs,27); eq(r.IPstr,"9"); eq(r.W,1); eq(r.K,10);
    eq(r.ERA.toFixed(2),"3.00");
  }
    {
    const T2=teamTotals([
      {runsFor:5,runsAgainst:3,batters:[]},
      {runsFor:2,runsAgainst:2,batters:[]},
      {runsFor:0,runsAgainst:1,batters:[]}
    ]);
    eq([T2.W,T2.L,T2.D],[1,1,1]); eq([T2.RF,T2.RA],[7,6]);
  }
    {
    const rows=[{a:1,b:"い"},{a:3,b:"あ"},{a:2,b:"う"}];
    eq(sortRows(rows,"a",-1).map(r=>r.a),[3,2,1],"数値降順");
    eq(sortRows(rows,"b",1).map(r=>r.b),["あ","い","う"],"文字列昇順");
    eq(sortRows(rows,null,1),rows,"key無しはそのまま");
  }
  });

  t("試合バッジ判定（勲章・屈辱）",()=>{
    {
    const gPerfect={
      runsFor:1, runsAgainst:0, side:"top",
      pitchers:[{name:"P",IP:"9",BF:27,H:0,BB:0,R:0,ER:0,W:true}]
    };
    const bPerfect=T.detectGameBadges(gPerfect);
    ok(bPerfect.includes("完全試合"), "完全試合が検出されること");
    ok(bPerfect.includes("完封")===false, "完全試合時は完封バッジは無し");
    const gWalkoff={
      runsFor:4, runsAgainst:3, side:"bottom",
      innings:{
        top:[0,0,0,0,0,0,0,3,0],
        bottom:[0,0,0,0,0,0,0,0,"4X"]
      },
      batters:[{name:"B",AB:1,H:1}]
    };
    const bWalkoff=T.detectGameBadges(gWalkoff);
    ok(bWalkoff.includes("サヨナラ勝ち"), "サヨナラ勝ちが検出されること");
  }
    {
    const D=T.detectGameBadges, Z=n=>Array.from({length:n},()=>0);
    // 自チーム先攻(top)で負け＋最終回裏Xで決着＝サヨナラ負け
    ok(D({runsFor:3,runsAgainst:4,side:"top",innings:{top:[0,0,0,3,0,0,0,0,0],bottom:[0,0,0,0,0,0,0,0,"4X"]},
      batters:[{name:"A",AB:4,H:2}],pitchers:[{name:"P",IP:"8.2",H:6,R:4}]}).includes("サヨナラ負け"));
    // サヨナラ勝ちが壊れていないこと（自チーム後攻）
    ok(D({runsFor:4,runsAgainst:3,side:"bottom",innings:{top:[0,0,0,0,0,0,0,3,0],bottom:[0,0,0,0,0,0,0,0,"4X"]},
      batters:[{name:"B",AB:1,H:1}],pitchers:[{name:"P",IP:"9",H:5,R:3}]}).includes("サヨナラ勝ち"));
    // 完封負け / ノーノーを許す / 完全試合を許す は上位1つだけ付く
    eq(D({runsFor:0,runsAgainst:5,side:"top",innings:{top:Z(9),bottom:Z(8)},
      batters:[{name:"A",AB:3,H:1},{name:"B",AB:3,H:1}],pitchers:[{name:"P",IP:"8",H:9,R:5}]}),["完封負け"]);
    eq(D({runsFor:0,runsAgainst:3,side:"top",innings:{top:Z(9),bottom:Z(8)},
      batters:[{name:"A",AB:3,H:0,BB:1},{name:"B",AB:3,H:0}],pitchers:[{name:"P",IP:"8",H:4,R:3}]}),["ノーヒットノーランを許す"]);
    eq(D({runsFor:0,runsAgainst:2,side:"top",innings:{top:Z(9),bottom:Z(8)},
      batters:[{name:"A",AB:3,H:0},{name:"B",AB:3,H:0}],pitchers:[{name:"P",IP:"8",H:3,R:2}]}),["完全試合を許す"]);
    // コールド負けと2桁失点は併記される
    const cold=D({runsFor:1,runsAgainst:11,side:"top",cold:true,innings:{top:[0,0,1,0,0,0,0],bottom:[2,0,3,0,6]},
      batters:[{name:"A",AB:3,H:1}],pitchers:[{name:"P",IP:"6",H:12,R:11}]});
    ok(cold.includes("コールド負け")&&cold.includes("2桁失点"));
    // 打撃を入力していない負け試合で誤爆しない（打数0は判定対象外）
    eq(D({runsFor:0,runsAgainst:3,side:"top",innings:{top:Z(9),bottom:Z(8)},batters:[],pitchers:[{name:"P",IP:"8",H:5,R:3}]}),[]);
    // 勝ち試合に屈辱バッジが混ざらない
    eq(D({runsFor:5,runsAgainst:0,side:"top",innings:{top:Z(9),bottom:Z(8)},
      batters:[{name:"A",AB:4,H:2}],pitchers:[{name:"P",IP:"9",H:3,BB:1,R:0}]}),["完封"]);
    // 色分け（勲章=gold/green、屈辱=bad）
    eq(badgeClassOf("サヨナラ負け"),"mbadge bad");
    eq(badgeClassOf("完封"),"mbadge green");
    eq(badgeClassOf("完全試合"),"mbadge gold legend");
  }
  });

  t("学年・シーズン・年度の判定",()=>{
    {
    eq(gradeInfo(2031,"2031夏県予選",2031).label,"1年");
    eq(gradeInfo(2031,"2033夏甲子園",2033),{label:"3年",retired:false},"夏甲子園までは現役");
    eq(gradeInfo(2031,"2033秋県予選・地区大会",2033).label,"引退","夏の後は引退");
    eq(gradeInfo(2031,"2034春甲子園",2034).label,"引退","春センバツは前年度扱いで3年引退");
    eq(gradeInfo(2031,"2034夏県予選",2034).label,"卒業");
    eq(gradeInfo(null,"2031夏県予選",2031).label,"","入学年未設定");
  }
    {
    eq(periodYearOf({date:"2032-03-15"}),2031,"1〜3月は前年度");
    eq(periodYearOf({date:"2032-04-01"}),2032);
    eq(periodYearOf({date:""}),null);
  }
    { eq(seasonYearOf("2032夏県予選",null),2032); eq(seasonYearOf("練習試合",[{date:"2031-05-01"}]),2031); }
    {
    const p=parseOpponentForSeason("2032夏県予選","県予選決勝 vs 田沢");
    eq([p.round,p.name],["7","田沢"]);
    const q=parseOpponentForSeason("2032夏県予選","ただの相手名");
    eq([q.round,q.name],["","ただの相手名"]);
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{
        "2032夏の甲子園":{games:[{id:"o1",date:"2032-08-10",batters:[],pitchers:[]}]},
        "練習試合":{games:[{id:"p1",date:"2033-05-01",batters:[],pitchers:[]}]}
      },current:"2032夏の甲子園",playerMeta:{}});
      const L=latestGameGlobally();
      eq(L.date,"2033-05-01","練習試合の最新日を基準に採る");
      eq(L.season,"練習試合");
      // 2032入学: 公式のみ(2032年度)なら1年、練習試合(2033年度)を含めると2年に進む
      eq(gradeInfo(2032,"2032夏の甲子園",2032).label,"1年","公式のみなら1年");
      eq(gradeInfo(2032,L.season,gameYear({date:L.date})).label,"2年","練習試合基準で2年に進む");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"2032夏の予選":{games:[{id:"a"}]},"練習試合":{games:[{id:"b"}]}},current:"2032夏の予選",playerMeta:{}});
      const all=seasonEntries().map(([n])=>n);
      ok(all.includes("練習試合"),"seasonEntriesは練習試合も含む");
      eq(all.length,2);
      const off=officialSeasonEntries().map(([n])=>n);
      ok(!off.includes("練習試合"),"officialSeasonEntriesは練習を除く");
      eq(off.length,1);
    }finally{ T.setDB(real); }
  }
  });

  t("DB操作・マージ・プロファイル",()=>{
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S1":{games:[{id:"a"}]},"S2":{games:{bad:"data"}}},current:"S1",playerMeta:{}});
      const r=mergeDB({seasons:{"S3":{games:[{id:"b"}]}}});
      eq(r.totalAdded,1);
      const db=T.getDB();
      eq(db.seasons["S3"].games.length,1);
      ok(!db.seasons["S2"].games.length,"壊れたシーズンは空配列として扱う");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{S:{games:[
        {id:"m1",date:"2032-07-28",opponent:"決勝 vs 田沢",runsFor:5,runsAgainst:4,
         innings:{top:[1,0,3],bottom:[2,0,"3X"]},
         batters:[{name:"清水"},{name:"森本"},{name:"鎌田"}]}
      ]}},current:"S",playerMeta:{}});
      eq(findMatchingGames({innings:{top:[1,0,3],bottom:[2,0,3]},runsFor:0,runsAgainst:0,batters:[]}).length,1,"innings一致（X・型差は正規化）");
      eq(findMatchingGames({runsFor:5,runsAgainst:4,batters:[{name:"清水"},{name:"森本"},{name:"鎌田"}]}).length,1,"スコア+打者名一致");
      eq(findMatchingGames({runsFor:5,runsAgainst:4,date:"2033-01-01",batters:[{name:"清水"},{name:"森本"},{name:"鎌田"}]}).length,0,"日付不一致なら除外");
      eq(findMatchingGames({runsFor:9,runsAgainst:9,batters:[{name:"別人"}]}).length,0,"不一致");
    }finally{ T.setDB(real); }
  }
    {
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
  }
    {
    const real=T.getDB();
    try{
      // 石井=名簿登録のみ, 石井七=試合出場（同姓が増えて表記が変わったケース）
      T.setDB({seasons:{"S1":{games:[
        {id:"g1",batters:[{name:"石井七",AB:3,H:2}],pitchers:[]}
      ]}},current:"S1",
        playerMeta:{[nameKey("石井")]:{name:"石井",fullName:"石井七海",enrollYear:2033}},
        playerAliases:{}, dismissedDuplicateHints:[]});
      ok(nameKey("石井")!==nameKey("石井七"),"統合前は別キー");
      // トラップ回避2: 名簿のみ(石井)×試合あり(石井七)は自動提案しない
      eq(findLikelyDuplicatePlayers().filter(c=>[c.key1,c.key2].includes("石井")&&[c.key1,c.key2].includes("石井七")).length,0,"名簿のみ×試合ありは自動提案しない");
      // 手動統合: 石井七 → 石井
      ok(mergePlayerAlias("石井七","石井"),"統合成功");
      eq(nameKey("石井七"),nameKey("石井"),"統合後は同一キーに解決");
      // 解除は生キーで
      ok(unmergePlayerAlias("石井七"),"解除成功");
      ok(nameKey("石井")!==nameKey("石井七"),"解除後は再び別キー");
      // トラップ回避1: 両方試合ありは別人物として提案しない
      T.setDB({seasons:{"S1":{games:[
        {id:"g1",batters:[{name:"田中",AB:3},{name:"田中健",AB:2}],pitchers:[]}
      ]}},current:"S1",playerMeta:{},playerAliases:{},dismissedDuplicateHints:[]});
      eq(findLikelyDuplicatePlayers().length,0,"両方試合ありは提案しない");
      // 前方一致で「短い方が試合あり」なら提案する
      T.setDB({seasons:{"S1":{games:[
        {id:"g1",batters:[{name:"佐藤",AB:3}],pitchers:[]}
      ]}},current:"S1",
        playerMeta:{[nameKey("佐藤太")]:{name:"佐藤太"}},playerAliases:{},dismissedDuplicateHints:[]});
      ok(findLikelyDuplicatePlayers().some(c=>[c.key1,c.key2].includes("佐藤")&&[c.key1,c.key2].includes("佐藤太")),"試合あり佐藤×名簿のみ佐藤太は提案する");
      // dismissedに入れたら提案しない
      T.getDB().dismissedDuplicateHints=["佐藤|佐藤太","佐藤太|佐藤"];
      eq(findLikelyDuplicatePlayers().length,0,"却下済みは出さない");
    }finally{
      T.setDB(real);
    }
  }
    {
    const real=T.getDB();
    const inp=document.querySelector("#playerSel");
    const savedVal=inp?inp.value:null;
    try{
      T.setDB({seasons:{"S1":{games:[{id:"g1",batters:[{name:"石井七",AB:1}],pitchers:[]}]}},current:"S1",
        playerMeta:{[nameKey("石井七")]:{name:"石井七",fullName:"石井 七海"}}});
      inp.value="石井 七海"; // フルネームで選択された想定
      eq(currentPlayerKey(),nameKey("石井七"),"フルネームからキー解決");
      inp.value="石井七";
      eq(currentPlayerKey(),nameKey("石井七"),"登録名からも解決");
      inp.value="いない人";
      eq(currentPlayerKey(),null,"未登録はnull");
    }finally{ T.setDB(real); if(inp) inp.value=savedVal; }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S1":{games:[{id:"a"}]}},current:"S1",playerAliases:{"石井七":"石井"},dismissedDuplicateHints:["x|y"]});
      mergeDB({seasons:{},playerAliases:{"石井":"石井太","石井七":"無視"},dismissedDuplicateHints:["x|y","p|q"]});
      const db=T.getDB();
      eq(db.playerAliases["石井"],"石井太","未設定キーは合流");
      eq(db.playerAliases["石井七"],"石井太","既存は上書きせず＋鎖(石井七→石井→石井太)を平坦化");
      eq(db.dismissedDuplicateHints.slice().sort(),["p|q","x|y"],"却下履歴は和集合");
    }finally{ T.setDB(real); }
  }
    {
    const db={seasons:{"S":{games:[{id:1}]}},current:"S",playerMeta:{[nameKey("既存")]:{name:"既存",enrollYear:2031}}};
    migrate(db);
    eq(db.playerMeta[nameKey("既存")].number,"","numberを空文字で補完");
    eq(db.playerMeta[nameKey("既存")].captain,false,"captainをfalseで補完");
    db.playerMeta[nameKey("既存")].number="9"; db.playerMeta[nameKey("既存")].captain=true;
    migrate(db);
    eq(db.playerMeta[nameKey("既存")].number,"9","既存値は上書きしない（冪等）");
    eq(db.playerMeta[nameKey("既存")].captain,true);
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[{id:"a"}]}},current:"S",playerMeta:{
        [nameKey("設定済")]:{name:"設定済",number:"7",captain:true},
        [nameKey("未設定")]:{name:"未設定",number:"",captain:false}
      }});
      mergeDB({seasons:{},playerMeta:{
        [nameKey("設定済")]:{number:"99",captain:false},
        [nameKey("未設定")]:{number:"3",captain:true}
      }});
      const db=T.getDB();
      eq(db.playerMeta[nameKey("設定済")].number,"7","この端末の背番号は上書きしない");
      eq(db.playerMeta[nameKey("設定済")].captain,true,"この端末の主将は上書きしない");
      eq(db.playerMeta[nameKey("未設定")].number,"3","未設定の背番号は合流で補完");
      eq(db.playerMeta[nameKey("未設定")].captain,true,"未設定の主将は合流で補完");
    }finally{ T.setDB(real); }
  }
    {
    const profs=T.getProfiles();
    ok(Array.isArray(profs)&&profs.length>=1,"プロファイル配列が1件以上");
    ok(profs.every(p=>p&&p.id&&p.name),"各プロファイルにid/name");
    const cur=T.getCurProfile();
    ok(profs.some(p=>p.id===cur),"現在idはプロファイル一覧に存在");
    if(cur==="default") eq(T.curKey(),"eikan-stats-v1","defaultは旧キーを流用（無損失移行の要）");
    else ok(T.curKey().indexOf("eikan-stats-v1::")===0,"追加プロファイルはサフィックス付きキー");
  }
  });

  t("分析カード（勝敗傾向・連勝連敗・月別）",()=>{
    {
    const P=T.pythagExpected;
    eq(P(0,0),0,"得失点ゼロは0扱い");
    eq(P(5,5),0.5,"同点なら.500");
    eq(P(10,0),1,"無失点は1");
    eq(P(0,10),0,"無得点は0");
    // 100得点50失点 → 100^2/(100^2+50^2)=0.8
    ok(Math.abs(P(100,50)-0.8)<1e-9,"RF^2/(RF^2+RA^2)になっていない");
    // 指数を差し替えられること
    ok(Math.abs(P(100,50,1)-(100/150))<1e-9,"指数を引数で上書きできる");
    // 文字列得点でも数値として扱う
    ok(Math.abs(P("100","50")-0.8)<1e-9,"文字列の得失点でも計算できる");
  }
    {
    const S=T.pythagSummary([
      {runsFor:5,runsAgainst:0}, // 勝ち
      {runsFor:0,runsAgainst:1}, // 負け
      {runsFor:2,runsAgainst:2}  // 引き分け
    ]);
    eq([S.G,S.W,S.L,S.D],[3,1,1,1]);
    eq([S.RF,S.RA],[7,3]);
    eq(S.actual,0.5,"引き分けを除いた1勝1敗で.500");
    ok(Math.abs(S.expected-(49/58))<1e-9,"期待勝率＝7^2/(7^2+3^2)");
    ok(Math.abs(S.diff-(S.actual-S.expected))<1e-12,"差＝実際−期待");
    eq(T.pythagSummary([]).G,0,"空配列でも落ちない");
  }
    {
    const C=T.computeStreaks;
    const S=(...res)=>res.map((r,i)=>({date:`2031-04-${String(i+1).padStart(2,"0")}`,res:r}));
    const a=C(S("W","W","W","L","L","W"));
    eq(a.maxWin.len,3); eq(a.maxLose.len,2);
    eq(a.maxWin.start,"2031-04-01"); eq(a.maxWin.end,"2031-04-03");
    eq(a.current.res,"W"); eq(a.current.len,1,"最後の1勝が継続中");
    // 引き分けは記録を途切れさせず、カウントも増やさない
    const b=C(S("W","D","W"));
    eq(b.maxWin.len,2,"引き分けを挟んでも連勝は途切れない");
    eq(b.current.len,2);
    const c=C(S("L","D","L","D","L"));
    eq(c.maxLose.len,3,"連敗も引き分けで途切れない");
    eq(c.maxWin.len,0);
    // 引き分けだけ・空
    eq(C(S("D","D")).current,null); eq(C([]).maxWin.len,0); eq(C(null).maxLose.len,0);
  }
    {
    const q=T.gameResultSeq([
      {date:"2031-08-01",runsFor:1,runsAgainst:0},
      {date:"",runsFor:0,runsAgainst:3},
      {date:"2031-05-01",runsFor:2,runsAgainst:2}
    ]);
    eq(q.map(x=>x.date),["2031-05-01","2031-08-01",""]);
    eq(q.map(x=>x.res),["D","W","L"]);
  }
    {
    const M=T.monthlyStats([
      {date:"2031-07-10",runsFor:5,runsAgainst:1},
      {date:"2031-07-20",runsFor:3,runsAgainst:4},
      {date:"2031-10-01",runsFor:0,runsAgainst:0},
      {date:"",runsFor:9,runsAgainst:0}      // 日付なしは対象外
    ]);
    eq(M.length,2,"7月と10月の2件");
    eq(M[0].month,7); eq([M[0].G,M[0].W,M[0].L,M[0].D],[2,1,1,0]);
    eq(M[0].winRate,0.5); eq(M[0].rfPerG,4); eq(M[0].raPerG,2.5);
    eq(M[1].month,10); eq(M[1].D,1); eq(M[1].winRate,0,"引き分けだけなら勝率0扱い");
    eq(T.monthlyStats([]).length,0);
  }
    {
    const T2=T.tieResponseData;
    // side=top(自チーム先攻)。表がこちら、裏が相手。
    // g1: 2回表2点先制→2回裏 相手2点で同点(追いつかれ)→3回表 こちら1点で返した = 反撃成功
    const g1={side:"top",innings:{top:[0,2,1],bottom:[0,2,0]}};
    // g2: 1回表3点→1回裏 相手3点で同点→2回表 こちら0点(返せず) = 反撃失敗
    const g2={side:"top",innings:{top:[3,0],bottom:[3,0]}};
    // g3: リードしていないので対象外（先に相手が得点）
    const g3={side:"top",innings:{top:[0,1],bottom:[2,0]}};
    // g4: 追いつかれてすぐ試合終了（次の自軍攻撃が無い）→分母に入れない
    const g4={side:"top",innings:{top:[1],bottom:[1]}};
    const r=T2([g1,g2,g3,g4]);
    eq([r.events,r.responses],[2,1],"g1成功・g2失敗の2件、g3/g4は対象外");
    eq(Math.round(r.rate*100),50);
    // side=bottom(自チーム後攻)でも同様に動く: 1回表 相手2点→1回裏2点で同点は「自分が追いついた」側なので対象外
    // 2回表 相手が2点でこちらリードを消す場面を作る
    const b1={side:"bottom",innings:{top:[0,2],bottom:[3,0]}}; // 1回裏3点先制→2回表相手2点(まだリード)→同点ではない=対象外
    eq(T2([b1]).events,0,"同点にされていない場面は数えない");
    eq(T2([]).events,0,"空でも落ちない");
  }
  });

  t("分析カード（打撃指標・打順・ベストナイン）",()=>{
    {
    // 10打数4安打（うち二塁打1・本塁打1）＋四死球2＋犠打1＝13打席、三振3
    const r=T.saberFrom({AB:10,H:4,"2B":1,"3B":0,HR:1,BB:2,SH:1,SO:3});
    eq(r.PA,13,"打席＝打数+四死球+犠打");
    eq(r.TB,8,"塁打＝安打4+二塁打1+三塁打0×2+本塁打1×3");
    eq(r.AVG,0.4); eq(r.SLG,0.8);
    ok(Math.abs(r.ISO-0.4)<1e-12,"IsoP＝長打率−打率");
    ok(Math.abs(r.BBpct-(2/13))<1e-12);
    ok(Math.abs(r.Kpct-(3/13))<1e-12);
    // 打数0でも0除算にならない
    const z=T.saberFrom({AB:0,H:0,BB:1,SH:0,SO:0});
    eq([z.AVG,z.SLG,z.ISO],[0,0,0]); eq(z.PA,1); eq(z.BBpct,1);
    // 既にPA/TBを持つaggBattingの行はその値を使う
    eq(T.saberFrom({AB:4,H:1,PA:99,TB:1}).PA,99);
  }
    {
    const real=T.getDB();
    try{
      const mk=(name,ab)=>({name,AB:ab,H:1});
      // 3試合 → 規定6打席。Aは9打席、Bは3打席
      const games=[
        {batters:[mk("A",3),mk("B",1)]},
        {batters:[mk("A",3),mk("B",1)]},
        {batters:[mk("A",3),mk("B",1)]}
      ];
      T.setDB({seasons:{},current:"",playerMeta:{}});
      const r=T.saberRows(games);
      eq(r.paMin,6); ok(r.qualified,"規定到達者がいる");
      eq(r.rows.map(x=>x.name),["A"],"規定未満のBは落ちる");
      const r2=T.saberRows([{batters:[mk("B",1)]},{batters:[mk("B",1)]},{batters:[mk("B",1)]}]);
      ok(!r2.qualified,"誰も規定に届かない");
      eq(r2.rows.length,1,"その場合は全員を参考表示");
    }finally{ T.setDB(real); }
  }
    {
    const A=T.appearanceRates;
    // 2031年度4試合 / 2032年度2試合 / 2034年度2試合
    const E=[];
    for(let i=0;i<4;i++) E.push({nendo:2031, keys:["a","b"]});
    for(let i=0;i<2;i++) E.push({nendo:2032, keys:["a"]});
    for(let i=0;i<2;i++) E.push({nendo:2034, keys:["c","d"]}); // dは2031年入学なのに2034年度に登場（在籍外）
    const rows=A(E, k=>({a:"エース",b:"控え",c:"新人",d:"謎"}[k]), k=>({a:2031,b:2031,c:2034,d:2031}[k]));
    const by=Object.fromEntries(rows.map(r=>[r.key,r]));
    eq(by.a.G,6); eq(by.a.denom,6,"2031〜2033年度のチーム試合数が分母");
    eq(by.a.rate,1);
    eq(by.b.G,4); eq(by.b.denom,6); ok(Math.abs(by.b.rate-(4/6))<1e-12);
    eq(by.c.denom,2,"2034年度の2試合だけが分母");
    eq(by.a.name,"エース"); eq(by.b.scope,"2031〜2033年度");
    // 在籍年度の外の出場は分子にも入れない（出場率が100%を超えない）
    eq([by.d.G,by.d.denom,by.d.rate],[0,6,0],"在籍外の試合は数えない");
    ok(rows.every(r=>r.rate<=1),"出場率が1を超えない");
    // 入学年が不明な選手は全試合数が分母
    const rows2=A(E, k=>k, ()=>null);
    eq(rows2.find(r=>r.key==="b").denom,8,"全8試合が分母");
    // 同じ試合に重複して名前が出ても1試合として数える
    eq(A([{nendo:2031,keys:["a","a"]}], k=>k, ()=>null)[0].G,1);
    eq(A([],k=>k,()=>null).length,0,"空でも落ちない");
  }
    {
    const L=T.lineupSuggestions;
    const orderRows=[
      {order:1,OBP:0.300,OPS:0.600,SLG:0.300,PA:50},
      {order:2,OBP:0.300,OPS:0.600,SLG:0.300,PA:50},
      {order:3,OBP:0.400,OPS:0.900,SLG:0.500,PA:50},
      {order:4,OBP:0.350,OPS:0.850,SLG:0.500,PA:50}
    ];
    const bat=[
      {name:"出塁マン",PA:40,OBP:0.500,OPS:0.800,SLG:0.300},
      {name:"二番手",  PA:40,OBP:0.450,OPS:0.750,SLG:0.300},
      {name:"長距離砲",PA:40,OBP:0.350,OPS:1.100,SLG:0.750},
      {name:"少打席",  PA:3, OBP:0.900,OPS:1.900,SLG:1.000} // 打席不足で候補外
    ];
    const s=L(orderRows,bat);
    eq(s.length,4);
    eq(s[0].cand.name,"出塁マン"); ok(s[0].improve,"1番の出塁率が大きく上がるので提案する");
    eq(s[1].cand.name,"二番手","同じ選手を2つの打順に割り当てない");
    ok(!s.some(x=>x.cand&&x.cand.name==="少打席"),"打席の少ない選手は候補にしない");
    // 4番はSLG基準。候補が残らない場合でも落ちない
    eq(L(orderRows,[]).every(x=>x.cand===null),true);
    // 差が小さければ improve=false
    const s2=L([{order:1,OBP:0.499,OPS:0.9,SLG:0.5,PA:50}],[{name:"X",PA:40,OBP:0.500,OPS:0.9,SLG:0.5}]);
    ok(!s2[0].improve,"わずかな差では提案しない");
  }
    {
    const W=T.CONTRIB_WEIGHTS;
    // OPS.800 で全試合出場 → 100*0.8*1 = 80
    ok(Math.abs(T.contribBatScore({OPS:0.8,G:20},20)-80)<1e-9);
    // 半分の出場なら半分
    ok(Math.abs(T.contribBatScore({OPS:0.8,G:10},20)-40)<1e-9);
    eq(T.contribBatScore({OPS:0.8,G:5},0),0,"チーム試合数0でも0除算しない");
    // 防御率0・チーム試合数と同じ投球回 → 100*1*1 = 100
    ok(Math.abs(T.contribPitScore({ERA:0,ipNum:20},20)-100)<1e-9);
    // 基準防御率ちょうどなら0
    ok(Math.abs(T.contribPitScore({ERA:W.pitEraBase,ipNum:20},20))<1e-9);
    // 基準より悪ければ負のスコア
    ok(T.contribPitScore({ERA:9,ipNum:20},20)<0);
    eq(T.contribPitScore({ERA:1,ipNum:0},20),0,"投球回0は0");
  }
    {
    const mk=(name,OPS,PA)=>({key:nameKey(name),name,OPS,PA,statStr:"",ERA:1,outs:90});
    const posMap={
      "投":[mk("P",0,0)],"捕":[mk("C",.9,60)],"一":[mk("Fa",.9,60)],"二":[mk("Se",.9,60)],
      "三":[mk("Th",.9,60)],"遊":[mk("Sh",.9,60)],
      "外":[mk("OF1",1.4,60),mk("OF4",1.2,60),mk("OF2",1.0,60),mk("OF3",.8,60)]
    };
    const bn=selectBestNine(posMap);
    const ofKeys=bn["外"].filter(o=>!o.isEmpty).map(o=>o.key);
    ok(!ofKeys.includes(bn["DH"].key),"DHは外野の誰とも重複しない");
    eq(bn["DH"].name,"OF3","外野4番手（選外の最高OPS）がDH");
  }
  });

  t("記録・楽しみ系（初記録・二つ名・節目・監督評価）",()=>{
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{},current:"",playerMeta:{},playerAliases:{}});
      const flat=[
        {season:"2031夏の予選", g:{id:"g1",date:"2031-07-10",opponent:"A校",runsFor:3,runsAgainst:5,batters:[{name:"田中",H:1}],pitchers:[]}},
        {season:"2031夏の予選", g:{id:"g2",date:"2031-07-15",opponent:"B校",runsFor:6,runsAgainst:2,batters:[{name:"田中",H:2,HR:1},{name:"佐藤",H:0}],pitchers:[{name:"鈴木",W:1}]}},
        {season:"2032夏の甲子園", g:{id:"g3",date:"2032-08-10",opponent:"C校",runsFor:1,runsAgainst:0,batters:[{name:"佐藤",H:1}],pitchers:[{name:"鈴木",W:1}]}},
        {season:"2032夏の甲子園", g:{id:"g4",date:"2032-08-20",opponent:"決勝 D校",runsFor:4,runsAgainst:3,batters:[{name:"田中",H:1,HR:1}],pitchers:[]}}
      ];
      const fr=T.computeFirstRecords(flat);
      eq(fr.team.map(x=>[x.label,x.gid]),[["部の初勝利","g2"],["初の甲子園出場","g3"],["甲子園 初勝利","g3"],["初の全国制覇","g4"]]);
      eq(fr.hits.map(x=>[x.name,x.gid]),[["田中","g1"],["佐藤","g3"]],"初安打は各選手の最初の該当");
      eq(fr.hrs.map(x=>[x.name,x.gid]),[["田中","g2"]]);
      eq(fr.wins.map(x=>[x.name,x.gid]),[["鈴木","g2"]]);
      eq(T.computeFirstRecords([]).team,[],"空でも落ちない");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{},current:"",playerMeta:{},playerAliases:{}});
      const list=T.assignNicknames({AVG:0.340,OBP:0.400,HR:20,RBI:50,SB:5,PA:120},null);
      eq(list.length,2,"複数該当でも上位2件まで");
      eq(list[0].title,"大砲"); eq(list[1].title,"チャンスに強い男");
      // 打席が少ないと高打率でも安打製造機を付けない（guard）
      eq(T.assignNicknames({AVG:0.500,OBP:0.5,HR:0,RBI:0,SB:0,PA:10},null).length,0);
      // 投手: 防御率(max方向・投球回guard)と奪三振
      const p=T.assignNicknames(null,{ERA:1.50,K:120,W:16,outs:200});
      eq(p[0].title,"鉄壁のエース"); eq(p[1].title,"奪三振マシン");
      // 投球回が足りなければ鉄壁のエースは付かない
      ok(!T.assignNicknames(null,{ERA:1.0,K:10,W:0,outs:30}).some(d=>d.title==="鉄壁のエース"));
    }finally{ T.setDB(real); }
  }
    {
    const nm=T.nextMilestones({H:27,HR:3,RBI:0,SB:0,K:0,W:0,Shutouts:0});
    eq(nm.length,2,"記録のある部門だけ");
    eq([nm[0].label,nm[0].remaining,nm[0].target],["本塁打",2,5],"残り本数が少ない順");
    eq([nm[1].label,nm[1].remaining,nm[1].target],["安打",3,30]);
    eq(T.nextMilestones({H:100}).length,0,"全節目を超えていれば出さない");
    eq(T.nextMilestones({}).length,0,"空でも落ちない");
  }
    {
    const real=T.getDB();
    try{
      T.setDB(T.migrate({seasons:{"2031夏":{games:[]}}, current:"2031夏", rivals:["A校","B校"]}));
      T.mergeDB({seasons:{}, rivals:["B校","C校"]});
      eq(T.getDB().rivals,["A校","B校","C校"],"重複せず和集合でマージ");
      eq(T.migrate({seasons:{},current:""}).rivals,[],"欠落時は空配列で補完");
      eq(T.migrate({seasons:{}, rivals:["X",123,"",null,"Y"]}).rivals,["X","Y"],"文字列以外・空文字は除去");
    }finally{ T.setDB(real); }
  }
    {
    eq(T.pickRetirementGame([{date:"a",retired:false},{date:"b",retired:false},{date:"c",retired:true}]).date,"b","引退直前の最後の出場");
    eq(T.pickRetirementGame([{retired:true}]),null); eq(T.pickRetirementGame([]),null);
    const rc=T.managerReportCard([
      {pitchers:[{name:"P",IP:"7"}],batters:[{name:"A",SB:1},{name:"B",SB:0}],runsFor:3,runsAgainst:2},
      {pitchers:[{name:"P",IP:"5"},{name:"Q",IP:"2"}],batters:[{name:"A",SB:0},{name:"C",sub:true,SB:2}],runsFor:1,runsAgainst:5},
      {pitchers:[],batters:[{name:"A"}],runsFor:4,runsAgainst:4}
    ]);
    eq(rc.games,3); eq(rc.starterGames,2); ok(Math.abs(rc.starterAvgIP-6)<1e-9,"先発平均投球回");
    ok(Math.abs(rc.pinchRate-1/3)<1e-9,"代打使用率"); ok(Math.abs(rc.sbPerGame-1)<1e-9,"盗塁/試合");
    eq([rc.closeGames,rc.closeWinRate],[1,1],"接戦は1点差のみ・引き分けは除外");
    const o=T.historicalLineupOrder([
      {key:"a",name:"A",pos:"外",OBP:0.5,OPS:0.8,SLG:0.3},
      {key:"b",name:"B",pos:"一",OBP:0.3,OPS:1.1,SLG:0.75},
      {key:"c",name:"C",pos:"二",OBP:0.45,OPS:0.75,SLG:0.3}
    ]);
    eq(o.length,9); eq([o[0].name,o[1].name,o[2].name],["A","C","B"],"1・2番＝出塁率, 3番＝OPS");
    const used=o.filter(x=>x.key).map(x=>x.key); eq(used.length,new Set(used).size,"同じ選手を重複させない");
  }
  });

  t("表彰・引退・健康チェックの集計",()=>{
    {
    const mkGame=()=>({
      batters:[
        {name:"強打",AB:3,H:2,"2B":0,"3B":0,HR:1,R:1,RBI:3,SO:0,BB:0,SH:0,SB:0,GDP:0,E:0},
        {name:"控え",AB:1,H:1,"2B":0,"3B":0,HR:0,R:0,RBI:0,SO:0,BB:0,SH:0,SB:0,GDP:0,E:0}
      ],
      pitchers:[{name:"エース",IP:"7",BF:24,H:3,K:5,BB:0,R:1,ER:1,WP:0,HR:0,W:true}]
    });
    const games=[mkGame(),mkGame(),mkGame()]; // teamG=3, paMin=6, ipMin=3
    const aw=computeSeasonAwards(games);
    const byLabel=l=>aw.find(a=>a.label===l||a.label===l+"（参考）");
    eq(byLabel("首位打者").name,"強打","規定打席未満の控え(1.000)は首位打者に選ばれない");
    ok(byLabel("首位打者").label.indexOf("参考")<0,"規定到達者がいるので参考ではない");
    eq(byLabel("最多本塁打").name,"強打");
    eq(byLabel("最多打点").name,"強打");
    eq(byLabel("最多盗塁").name,"該当なし","盗塁0は該当なし");
    eq(byLabel("最多盗塁").key,null);
    eq(byLabel("最多勝").name,"エース");
    eq(byLabel("最優秀防御率").name,"エース");
    eq(byLabel("最多奪三振").name,"エース");
    ok(aw.find(a=>a.label==="MVP").key!=null,"MVPが選出される");
    // 参考選出: 規定到達者ゼロ（全員PA<規定）なら（参考）が付く
    const aw2=computeSeasonAwards([{batters:[{name:"少数",AB:1,H:1,BB:0,SH:0,HR:0,SB:0,RBI:0,"2B":0,"3B":0,SO:0}],pitchers:[]}]);
    const b2=aw2.find(a=>a.label.indexOf("首位打者")===0);
    ok(b2.label.indexOf("参考")>=0,"規定到達ゼロは参考選出");
    eq(b2.name,"少数");
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,date:"2032-05-01",batters:[{name:"打",AB:3,H:1}]},   // 安打→cur1 best1
        {id:2,date:"2032-05-02",batters:[{name:"打",AB:0,H:0}]},   // 打数0→スキップ（継続維持）
        {id:3,date:"2032-05-03",batters:[{name:"打",AB:2,H:2}]},   // 安打→cur2 best2
        {id:4,date:"2032-05-04",batters:[{name:"打",AB:3,H:0}]},   // 無安打→途切れ cur0
        {id:5,date:"2032-05-05",batters:[{name:"打",AB:1,H:1}]}    // 安打→cur1
      ]}},current:"S",playerMeta:{}});
      const r=hitStreaks().find(x=>x.name==="打");
      eq(r.best,2,"打数0を挟んでも連続2試合が最長");
      eq(r.cur,1,"無安打で途切れた後の再開で1試合");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"2034夏県予選":{games:[{id:1,date:"2034-07-01",batters:[{name:"卒業生",AB:1,H:1}]}]}},current:"2034夏県予選",
        playerMeta:{[nameKey("卒業生")]:{name:"卒業生",enrollYear:2031},[nameKey("現役")]:{name:"現役",enrollYear:2034}}});
      ok(isPlayerRetired(nameKey("卒業生")),"2031入学・2034夏基準は引退/卒業");
      ok(!isPlayerRetired(nameKey("現役")),"2034入学は現役");
      ok(!isPlayerRetired(nameKey("未登録")),"入学年不明は現役扱い");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,date:"2032-05-01",opponent:"A校",innings:{top:[1,0],bottom:[0,0]},batters:[{name:"甲",AB:1}]},
        {id:2,date:"2032-05-02",opponent:"",innings:{top:[],bottom:[]},batters:[{name:"乙",AB:1}]}
      ]}},current:"S",
        playerMeta:{[nameKey("甲")]:{name:"甲",enrollYear:2031,position:"外野"},[nameKey("乙")]:{name:"乙"}}});
      const h=healthCheckData();
      eq(h.total,2);
      eq(h.noInnings.length,1,"g2はイニング未入力");
      eq(String(h.noInnings[0].g.id),"2");
      eq(h.noOpp.length,1,"g2は相手名なし");
      eq(h.noEnroll.length,1,"乙は入学年未設定");
      ok(h.noEnroll.some(([k])=>k===nameKey("乙")));
      eq(h.noPos.length,1,"乙は守備位置未設定");
    }finally{ T.setDB(real); }
  }
  });

  t("監督室の集計（イニング・記録・打順・救援）",()=>{
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,side:"top",runsFor:3,runsAgainst:2,innings:{top:[1,0,0,0,0,0,0,0,2],bottom:[0,0,0,0,0,0,0,0,2]},batters:[],pitchers:[]},
        {id:2,side:"bottom",runsFor:3,runsAgainst:5,innings:{top:[2,0,0,0,0,0,0,0,3],bottom:[0,0,0,0,0,0,0,0,3]},batters:[],pitchers:[]}
      ]}},current:"S",playerMeta:{}});
      const d=inningsAnalysisData();
      eq(d.total,2);
      eq(d.close1.W,1,"1点差ゲームは勝ち1（g1のみ）");
      eq([d.close2.W,d.close2.L],[1,1],"2点差以内は勝1敗1");
      eq(d.usedInnGames,2);
      eq(d.scored[9],5,"9回の自チーム得点合計 g1:2+g2:3");
      eq(d.allowed[1],2,"1回の失点 g2の相手先制2");
      eq(d.firstSelf.W,1,"自チーム先制→勝ち(g1)");
      eq(d.firstOpp.L,1,"相手先制→負け(g2)");
      eq(d.firstCounted,2);
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,date:"2032-05-01",opponent:"A",batters:[{name:"打者",AB:5,H:4,HR:2,RBI:5}],pitchers:[{name:"投手",K:10}]},
        {id:2,date:"2032-05-02",opponent:"B",batters:[{name:"打者",AB:4,H:4,HR:1,RBI:3}],pitchers:[{name:"投手",K:12}]},
        {id:3,date:"2032-04-01",opponent:"C",batters:[{name:"別人",AB:4,H:4,HR:0,RBI:1}],pitchers:[]}
      ]}},current:"S",playerMeta:{}});
      const cats=recordRankings();
      const hcat=cats.find(c=>c.label.indexOf("安打")>=0);
      eq(hcat.rows[0].v,4);
      eq(hcat.rows[0].name,"別人","同値は日付昇順（古い方）が上位");
      eq(hcat.rows[1].name,"打者");
      const hrcat=cats.find(c=>c.label.indexOf("本塁打")>=0);
      eq([hrcat.rows[0].v,hrcat.rows[0].name],[2,"打者"]);
      const kcat=cats.find(c=>c.label.indexOf("奪三振")>=0);
      eq(kcat.rows[0].v,12,"1試合最多奪三振");
    }finally{ T.setDB(real); }
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,batters:[
          {name:"一番",order:1,AB:4,H:2,BB:1,SH:0},
          {name:"四番",order:4,AB:4,H:1,HR:1,RBI:2},
          {name:"謎",order:0,AB:3,H:1},
          {name:"代打",order:9,AB:1,H:1,sub:true}
        ]}
      ]}},current:"S",playerMeta:{}});
      const rows=battingOrderStats();
      const b1=rows.find(r=>r.order===1);
      eq([b1.AB,b1.H,b1.PA],[4,2,5],"1番: PA=AB+BB+SH=4+1+0");
      eq(rows.find(r=>r.order===4).HR,1);
      const unk=rows.find(r=>r.order==="?");
      ok(unk,"範囲外の打順は打順不明バケツ");
      eq(unk.AB,3);
      eq(rows.find(r=>r.order===9).H,1,"sub打者も打順9に計上");
    }finally{ T.setDB(real); }
  }
    {
    const key=nameKey("代打");
    const games=[
      {batters:[{name:"代打",sub:true,AB:2,H:1,HR:1,RBI:2}]},
      {batters:[{name:"代打",sub:false,AB:3,H:2}]},
      {batters:[{name:"代打",sub:true,AB:1,H:0}]}
    ];
    const s=subBattingBreakdown(key,games);
    eq(s.G,2,"sub打席のある試合数");
    eq(s.AB,3,"2+1（非subは除外）");
    eq([s.H,s.HR],[1,1]);
    eq(subBattingBreakdown(nameKey("誰も"),games),null,"sub打席ゼロはnull");
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[
        {id:1,side:"top",runsFor:4,runsAgainst:3,innings:{top:[0,0,0,0,0,0,0,0,4],bottom:[0,0,3,0,0,0,0,0,0]},batters:[],pitchers:[]},
        {id:2,side:"bottom",runsFor:4,runsAgainst:3,innings:{top:[0,0,0,3,0,0,0,0,0],bottom:[0,0,0,0,0,0,0,0,"4X"]},batters:[{name:"B",AB:1,H:1}],pitchers:[]},
        {id:3,side:"top",runsFor:2,runsAgainst:3,innings:{top:[2,0,0,0,0,0,0,0,0],bottom:[0,0,0,0,0,0,0,3,0]},batters:[],pitchers:[]}
      ]}},current:"S",playerMeta:{}});
      const c=comebackGames();
      ok(c.wins.some(r=>String(r.id)==="1"),"逆転勝ちを検出");
      ok(c.walkoffs.some(r=>String(r.id)==="2"),"サヨナラ勝ちを検出（detectGameBadges定義と一致）");
      ok(c.losses.some(r=>String(r.id)==="3"),"逆転負けを検出");
    }finally{ T.setDB(real); }
  }
    {
    const key=nameKey("投");
    const games=[
      {runsFor:5,runsAgainst:0,pitchers:[{name:"投",IP:"9",ER:0}]},
      {runsFor:4,runsAgainst:2,pitchers:[{name:"投",IP:"7",ER:2}]},
      {runsFor:3,runsAgainst:4,pitchers:[{name:"投",IP:"5.2",ER:3},{name:"控",IP:"3",ER:1}]}
    ];
    const q=pitcherQualityStats(key,games);
    eq(q.G,3,"登板3試合");
    eq(q.QS,2,"18アウト以上かつ自責3以内が2試合");
    eq(q.CG,2,"単独投手（完投）が2試合");
    eq(q.SHO,1,"完封（無失点勝ち）が1試合");
    eq(pitcherQualityStats(nameKey("いない"),games),null,"登板ゼロはnull");
  }
    {
    const real=T.getDB();
    try{
      T.setDB({seasons:{"S":{games:[]}},current:"S",playerMeta:{
        [nameKey("背番")]:{name:"背番",number:"7"},
        [nameKey("主将")]:{name:"主将",captain:true},
        [nameKey("両方")]:{name:"両方",number:"1",captain:true},
        [nameKey("無し")]:{name:"無し",number:"",captain:false}
      }});
      const bn=metaMarks(nameKey("背番"));
      ok(bn.indexOf("nummark")>=0 && bn.indexOf("7")>=0,"背番号ピル");
      const cap=metaMarks(nameKey("主将"));
      ok(cap.indexOf("capmark")>=0 && cap.indexOf("主将")>=0,"主将ピル");
      const both=metaMarks(nameKey("両方"));
      ok(both.indexOf("nummark")>=0 && both.indexOf("capmark")>=0,"両方表示");
      eq(metaMarks(nameKey("無し")),"","未設定は空文字");
      eq(metaMarks(nameKey("存在しない")),"","メタ無しは空文字");
    }finally{ T.setDB(real); }
  }
  });

  t("OCR後処理（多数決・X誤読補正・雛形）",()=>{
    {
    const correct={name:"森下",AB:4,R:2,H:2,HR:2,RBI:4};
    const shifted={name:"森下",AB:4,R:2,H:2,SO:2,RBI:4}; // 本塁打2が抜けて三振2に紛れた誤読
    const g=voteOcrReads([
      {batters:[correct],pitchers:[],innings:{top:[3],bottom:[]},myTeamSide:"top"},
      {batters:[shifted],pitchers:[],innings:{top:[],bottom:[]}},
      {batters:[correct],pitchers:[],innings:{top:[3],bottom:[]},myTeamSide:"top"}
    ]);
    const m=g.batters.find(b=>b.name==="森下");
    eq(m.HR,2,"本塁打は多数決で復活");
    eq(m.SO,0,"三振の誤混入は多数決で棄却");
    eq(m.RBI,4,"打点は維持");
    eq(g.myTeamSide,"top","sideはスコアボードのコマから");
    eq(voteOcrReads([{batters:[correct]}]).batters[0].HR,2,"1コマならそのまま");
  }
    {
    // 3コマ中1コマだけ本塁打を三振の列にズラして誤読（HRが0・SOに1）。名前も1コマだけ空白入り
    const reads=[
      { batters:[{name:"白 井",AB:3,H:2,HR:1,RBI:2}] },
      { batters:[{name:"白井",AB:3,H:2,HR:1,RBI:2}] },
      { batters:[{name:"白井",AB:3,H:2,HR:0,RBI:0,SO:1}] }
    ];
    const g=T.voteOcrReads(reads);
    eq(g.batters.length,1,"同一選手は1行に集約");
    const b=g.batters[0];
    eq(b.name,"白井","表記は多数決で正規表記に寄る");
    eq([b.HR,b.RBI,b.SO],[1,2,0],"誤読コマは多数決で棄却される");
  }
    {
    // 自チーム後攻。裏の最終マス(=X)を数字3と誤読し、裏合計が本来より+3膨らんでいる
    const g=T.ocrGoldenTemplate({ myTeamSide:"bottom", runsFor:2, runsAgainst:1,
      innings:{ top:[1,0,0,0,0,0,0,0,0], bottom:[0,2,0,0,0,0,0,0,0,3] } });
    T.fixInningsXMisread(g);
    eq(g.innings.bottom.length,9,"誤読マスが1つ除去される");
    eq(g.innings.bottom.reduce((s,v)=>s+T.n(v),0),2,"除去後の裏合計がR列と一致");
    // 正常な試合は書き換えない
    const ok=T.ocrGoldenTemplate({ myTeamSide:"bottom", runsFor:2, runsAgainst:1,
      innings:{ top:[1,0,0,0,0,0,0,0,0], bottom:[0,2,0,0,0,0,0,0,0] } });
    const before=JSON.stringify(ok.innings);
    T.fixInningsXMisread(ok);
    eq(JSON.stringify(ok.innings),before,"整合している試合は無改変");
  }
    {
    const base=T.ocrGoldenTemplate();
    eq([base.runsFor,base.runsAgainst,base.cold],[0,0,false],"既定は空の正解形");
    eq(base.innings,{top:[],bottom:[]},"innings既定");
    const g=T.ocrGoldenTemplate({opponent:"甲子園決勝",innings:{top:[3]}});
    eq(g.opponent,"甲子園決勝"); eq(g.innings,{top:[3],bottom:[]},"部分innings上書きでbottomは既定維持");
  }
  });

  t("フレーム推奨（サンプル時刻・推奨選定）",()=>{
    {
    eq(T.fpSampleTimes(3,2,150),[0,0.5,1,1.5,2,2.5],"0.5秒刻み・duration未満まで");
    eq(T.fpSampleTimes(10,2,3).length,3,"maxで打ち切り");
    eq(T.fpSampleTimes(30,2,150).length,60,"30秒×2fps=60枚");
    eq(T.fpSampleTimes(0,2,10),[],"長さ0は空");
    eq(T.fpSampleTimes(0.3,2,150),[0],"極短でも最低1枚");
  }
    {
    const P=T.fpPickRecommended;
    const play    =()=>({sharp:.20,isSame:false,isBlur:false,green:.62}); // 試合中(毎コマ変化・芝と土)
    const playStill=()=>({sharp:.20,isSame:true, isBlur:false,green:.62}); // 試合中だが静止(勝利画面など)
    const uiHead  =(s)=>({sharp:s,  isSame:false,isBlur:false,green:.05}); // 成績画面の1枚目
    const ui      =(s)=>({sharp:s,  isSame:true, isBlur:false,green:.05}); // 成績画面の継続コマ
    const F=[];
    for(let i=0;i<8;i++) F.push(play());                    // 0-7 試合映像
    F.push(playStill()); F.push(playStill());               // 8-9 静止だが芝・土が多い
    F.push(uiHead(.30)); F.push(ui(.34)); F.push(ui(.28));  // 10-12 野手記録（最鮮明=11）
    F.push(uiHead(.31)); F.push(ui(.36)); F.push(ui(.30));  // 13-15 投手記録（最鮮明=14）
    F.push(uiHead(.29)); F.push(ui(.33));                   // 16-17 打席結果（最鮮明=17）
    F.push(uiHead(.32)); F.push(ui(.35)); F.push(ui(.27));  // 18-20 スコアボード（最鮮明=19）
    const r=P(F);
    eq(r,[11,14,17,19],"各成績画面から最も鮮明な1枚ずつを選び、試合映像は選ばない");
    ok(r.every(i=>i>=10),"試合映像(0〜9)が混ざらない");
    // 総数が最低枚数以下なら全部返す（水増しも間引きもしない）
    eq(P([ui(.3),ui(.2),ui(.1)]).length,3);
    eq(P([]),[],"空でも落ちない");
    // 上限を超えて推奨しない（API消費の歯止め）
    const many=[]; for(let k=0;k<20;k++){ many.push(uiHead(.3)); many.push(ui(.3)); }
    ok(P(many).length<=8,"推奨は上限8枚まで");
  }
  });

  t("第102弾: 投手セイバー・トロフィー棚",()=>{
    {
    // saberPitchFrom: 9回・被安打6・四死球3・奪三振9・被本1・自責2
    const s=T.saberPitchFrom({ipNum:9,H:6,BB:3,K:9,HR:1,ER:2});
    eq(s.ip,9);
    ok(Math.abs(s.ERA-2)<1e-9,"ERA=ER*9/ip");
    ok(Math.abs(s.WHIP-1)<1e-9,"WHIP=(BB+H)/ip");
    ok(Math.abs(s.K9-9)<1e-9); ok(Math.abs(s.H9-6)<1e-9); ok(Math.abs(s.HR9-1)<1e-9);
    ok(Math.abs(s.KBB-3)<1e-9,"K/BB=9/3");
    // 四死球0はKBB=null（ダッシュ表記）、投球回0は全部0で落ちない
    eq(T.saberPitchFrom({ipNum:9,H:1,BB:0,K:5,HR:0,ER:0}).KBB,null);
    const z=T.saberPitchFrom({outs:0,H:0,BB:0,K:0,HR:0,ER:0});
    eq([z.ip,z.ERA,z.WHIP,z.K9],[0,0,0,0]);
    // outsからipを算出できる（6.1回＝19アウト）
    ok(Math.abs(T.saberPitchFrom({outs:19,ER:0}).ip-(19/3))<1e-9);
    }
    {
    // saberPitchRows: 3試合→規定3回。Aは9回、Bは1回
    const games=[
      {pitchers:[{name:"A",IP:"3",H:2,BB:0,K:3,ER:0}]},
      {pitchers:[{name:"A",IP:"3",H:2,BB:0,K:3,ER:0}]},
      {pitchers:[{name:"A",IP:"3",H:2,BB:0,K:3,ER:0},{name:"B",IP:"1",H:1,BB:0,K:1,ER:0}]}
    ];
    const r=T.saberPitchRows(games);
    eq(r.ipMin,3); ok(r.qualified,"規定到達者がいる");
    eq(r.rows.map(x=>x.name),["A"],"規定未満のBは落ちる");
    ok(!T.saberPitchRows([{pitchers:[{name:"B",IP:"0.2",ER:0}]}]).qualified,"規定(1回)未満なら参考表示（0.2回=2/3回）");
    }
    {
    // trophyShelf: 決勝勝ちのあるシーズンだけ優勝としてカウント
    const F=(win)=>({opponent:win?"決勝 vs X":"準決勝 vs X",runsFor:win?5:1,runsAgainst:win?2:3});
    const entries=[
      ["2031夏の甲子園",{games:[F(true)]}],   // 全国制覇
      ["2032夏の甲子園",{games:[F(true)]}],   // 全国制覇（最新2032）
      ["2031夏県予選",{games:[F(true)]}],     // 県予選優勝
      ["2032夏県予選",{games:[F(false)]}],    // 決勝負け＝優勝でない
      ["2031秋県予選・地区大会",{games:[F(true)]}]
    ];
    const rows=T.trophyShelf(entries);
    const by=Object.fromEntries(rows.map(r=>[r.label,r]));
    eq([by["夏の甲子園"].count,by["夏の甲子園"].latestYear],[2,2032]);
    ok(by["夏の甲子園"].champ,"夏の甲子園はchampフラグ");
    eq(by["夏の県予選"].count,1,"決勝負けは数えない");
    eq(by["秋の県・地区"].count,1);
    eq(by["神宮大会"].count,0,"該当なしは0");
    eq(T.trophyShelf([]).every(r=>r.count===0),true,"空でも落ちない");
    }
  });

  t("第103弾: 動画プール（判定・保存後の名前）",()=>{
    // 動画ファイルの判別（一覧から画像を除くため）
    ok(T.vpIsVideo("a.mov")); ok(T.vpIsVideo("A.MP4")); ok(T.vpIsVideo("x.webm"));
    ok(!T.vpIsVideo("photo.jpg")); ok(!T.vpIsVideo("")); ok(!T.vpIsVideo("noext"));
    // 済判定
    ok(T.vpIsDone("済_0815対久慈南_x.mov")); ok(!T.vpIsDone("20260723-x.mov"));
    // 保存後の名前: 日付は月日4桁、相手はラウンドを落として学校名だけ
    eq(T.vpDoneName("ORIG.mov",{date:"2032-08-15",opponent:"決勝 vs 久慈南"}),"済_0815対久慈南_ORIG");
    eq(T.vpDoneName("ORIG.mov",{date:"2032-07-03",opponent:"県予選2回戦 vs 天栄北"}),"済_0703対天栄北_ORIG");
    eq(T.vpDoneName("ORIG.mov",{date:"2032-08-20",opponent:"久慈南"}),"済_0820対久慈南_ORIG","vsが無ければそのまま学校名");
    eq(T.vpDoneName("ORIG.mov",{date:"2031-06-01",opponent:"対 銀座"}),"済_0601対銀座_ORIG");
    eq(T.vpDoneName("ORIG.mov",{date:"2032-05-05",opponent:""}),"済_0505_ORIG","相手名なしでも日付だけで付く");
    // 再解析しても済ラベルが二重にならない
    eq(T.vpDoneName("済_0810対天栄北_ORIG.mov",{date:"2032-08-11",opponent:"決勝 vs 銀座"}),"済_0811対銀座_ORIG");
    // 拡張子は付けない（サーバー側が元の拡張子を維持する）
    ok(T.vpDoneName("ORIG.mov",{date:"2032-08-15",opponent:"X"}).indexOf(".mov")<0);
  });

  t("第105弾: OCR結果キャッシュ（同じ動画を二度APIに投げない）",()=>{
    const saved=localStorage.getItem("eikan-ocr-cache");
    try{
      localStorage.removeItem("eikan-ocr-cache");
      eq(T.vpCacheAll(),[],"初期状態は空");
      eq(T.vpCacheFind("a.mov",100),null,"無ければnull");
      // 保存して名前で引ける
      T.vpCachePut("a.mov",100,{opponent:"久慈南",runsFor:5,runsAgainst:2,batters:[{name:"A"},{name:"B"}]});
      const c=T.vpCacheFind("a.mov",100);
      ok(c,"名前で見つかる"); eq(c.g.runsFor,5); eq(c.size,100);
      // リネームされてもサイズが同じなら拾える（済_付きに変わっても結果を使い回せる）
      ok(T.vpCacheFind("済_0815対久慈南_a.mov",100),"サイズ一致で拾える");
      // サイズも名前も違えば別物
      eq(T.vpCacheFind("b.mov",999),null);
      // 同じ動画を再登録しても重複しない（上書き）
      T.vpCachePut("a.mov",100,{opponent:"天栄北",runsFor:1,runsAgainst:0,batters:[]});
      eq(T.vpCacheAll().length,1,"重複せず1件");
      eq(T.vpCacheFind("a.mov",100).g.opponent,"天栄北","新しい結果で上書き");
      // 概要テキスト（一覧のツールチップ用）
      const s=T.vpCacheSummary(T.vpCacheFind("a.mov",100));
      ok(s.detail.indexOf("対天栄北")>=0 && s.detail.indexOf("1-0")>=0,"相手とスコアが入る");
      // 破棄
      T.vpCacheDrop("a.mov",100);
      eq(T.vpCacheAll(),[],"破棄できる");
      // 上限を超えたら古いものから落ちる
      for(let i=0;i<T.VP_CACHE_MAX+5;i++) T.vpCachePut("v"+i+".mov",i+1,{opponent:"X"+i,batters:[]});
      eq(T.vpCacheAll().length,T.VP_CACHE_MAX,"上限でローテート");
      ok(T.vpCacheFind("v"+(T.VP_CACHE_MAX+4)+".mov",T.VP_CACHE_MAX+5),"最新は残る");
      eq(T.vpCacheFind("v0.mov",1),null,"最古は落ちる");
      // 壊れたJSONでも落ちない
      localStorage.setItem("eikan-ocr-cache","{壊れた");
      eq(T.vpCacheAll(),[],"パース失敗時は空配列");
    }finally{
      if(saved==null) localStorage.removeItem("eikan-ocr-cache"); else localStorage.setItem("eikan-ocr-cache",saved);
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
  const prov=(localStorage.getItem("eikan-provider")==="openrouter")? "openrouter" : "gemini";
  const kName=prov==="openrouter"? "eikan-orkey" : "eikan-gemkey";
  const mName=prov==="openrouter"? "eikan-ormodel" : "eikan-gemmodel";
  const defModel=prov==="openrouter"? window.__test.DEF_OR_MODEL : window.__test.DEF_MODEL;
  const keyInput=document.getElementById("gemKey");
  const key=(keyInput&&keyInput.value.trim()) || localStorage.getItem(kName) || "";
  const modelInput=document.getElementById("gemModel");
  const model=(modelInput&&modelInput.value.trim()) || localStorage.getItem(mName) || defModel;
  return {key,model,prov};
}
async function loadCases(){
  const cfgEl=panel.querySelector("#tOcrCfg");
  const {key,model}=gemCfg();
  if(!key){
    cfgEl.textContent="⚠ APIキー未設定。先に「試合を追加」タブで設定してください。";
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
    listHtml=`<div class="tnote">tests/cases.json を読み込めませんでした（file:// で開いている場合は下の手動実行を使ってください）</div>`;
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
  const {key}=gemCfg();
  if(!key){ box.innerHTML='<span class="tfail">APIキー未設定</span>'; return; }
  box.innerHTML='<span class="tspin"></span>解析中…';
  // アプリ本体のaiGenerate(プロバイダ両対応・自動リトライ付き)をそのまま使う
  let txt=await aiGenerate(window.__test.OCR_PROMPT, imageBlobs, box);
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
        if(!res.ok) throw new Error(`画像を読み込めません: ${path}（tests/フォルダに配置した？）`);
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
    alert("テスト起動失敗: アプリの初期化を検出できませんでした");
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
