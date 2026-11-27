/* 사단 통합 톡 — 앱 로직
 * - 데모 모드(내장 스냅숏) / 실제 모드(Google Apps Script 웹앱 API)
 * - 시트 행을 카톡 말풍선으로 렌더링, 지시 입력 → 시트 마지막 행에 기록
 */
(() => {
  'use strict';

  /* ───────── 상수 ───────── */
  const CFG_KEY = 'sadan.talk.config.v1';
  const SEEN_KEY = 'sadan.talk.seen.v1';
  const TARGET_KEY = 'sadan.talk.target.v1';
  const TABS_CACHE_KEY = 'sadan.talk.tabs.v1';

  const SHEETS = {
    b: { key: 'b', id: '1O2JNo09djaXuHBicPF0sIGrGBhnPufPtNAv401ReNg4', name: 'B사단 요청함', short: 'B', tone: 'b' },
    a: { key: 'a', id: '1oj_yCMIAqTffwOL27NpAc8w1vC6Pxxn6cWdfzaqPiN8', name: 'Instinct 요청함', short: 'A', tone: 'a' }
  };

  const B_TABS = ['시트1', 'Muse-B', '피클-B', '부이-B', 'Hark-B', '뀨-B', '키링-B', '경험은행'];
  const A_MAIN_TABS = ['피클', '라운 채팅', '시트1'];
  // A시트 ai채팅 탭은 [시간 | 작성자 | 내용 | 관련] 네 열짜리 채팅 로그다.
  const AI_CHAT_TAB = 'ai채팅';

  const ROOMS = [
    {
      id: 'all', name: '전체 통합방', emoji: '💬', color: '#4E5968',
      desc: 'A·B사단 주요 기록',
      sources: [
        { sheet: 'b', tabs: B_TABS },
        { sheet: 'a', tabs: A_MAIN_TABS }
      ]
    },
    {
      id: 'b', name: 'B사단 방', emoji: 'B', color: '#7C5CFF',
      desc: 'B사단 요청함 · 시트1 + 대원 탭',
      sources: [{ sheet: 'b', tabs: B_TABS }]
    },
    {
      id: 'a', name: 'A사단 방', emoji: 'A', color: '#12B76A',
      desc: 'Instinct 요청함 · 피클·사단장 기록',
      sources: [{ sheet: 'a', tabs: A_MAIN_TABS }]
    },
    {
      id: 'aichat', name: 'AI 채팅방', emoji: '💭', color: '#0EA5E9',
      desc: 'A시트 ai채팅 · Muse·Muse-B·부이·부이-B·Instinct·Pally',
      sources: [{ sheet: 'a', tabs: [AI_CHAT_TAB] }],
      // 이 방에 들어가면 전송 대상이 자동으로 A시트 ai채팅 탭이 된다.
      target: { sheet: 'a', tab: AI_CHAT_TAB }
    },
    {
      id: 'office', name: '사단 오피스', emoji: '🏢', color: '#F59E0B',
      desc: '사장방 · 팀장석 · A·B 전 대원 근무 현황',
      kind: 'office',
      sources: [
        { sheet: 'b', tabs: B_TABS },
        { sheet: 'a', tabs: ['피클', '라운 채팅', '시트1', AI_CHAT_TAB] }
      ]
    },
    {
      id: 'workflow', name: '사단 워크플로우', emoji: '🔀', color: '#6366F1',
      desc: '누가 · 어디에 · 무엇을 올렸는지 게시·출고 흐름',
      kind: 'workflow',
      sources: [
        { sheet: 'b', tabs: B_TABS },
        { sheet: 'a', tabs: ['피클', '라운 채팅', '시트1', AI_CHAT_TAB] }
      ]
    }
  ];

  // '태그 없음'은 태그 없이 [지시] 로만 제목을 기록한다.
  const NO_TAG = '태그 없음';
  const TAGS = {
    b: ['@전체', NO_TAG, '@Muse-B', '@피클-B', '@부이-B', '@Hark-B', '@뀨-B', '@키링-B'],
    a: ['@전체', NO_TAG, '@Muse', '@Instinct', '@뀨', '@키링']
  };
  const titleForTag = (tag) => (tag === NO_TAG || !tag ? '[지시]' : `[지시] ${tag}`);

  // A시트 ai채팅 탭은 [시간 | 작성자 | 내용 | 관련] 네 열짜리 채팅 로그다.
  // '관련'(D열)에는 [지시] 같은 머리말 없이 태그(또는 주제)만 들어가야 한다.
  const AI_CHAT_TAGS = ['@전체', NO_TAG, '@Muse', '@Muse-B', '@부이', '@부이-B', '@Instinct', '@Pally'];
  const inAiChat = () => state.target.sheet === 'a' && state.target.tab === AI_CHAT_TAB;
  const tagsForTarget = () => (inAiChat() ? AI_CHAT_TAGS : (TAGS[state.target.sheet] || ['@전체']));
  // 태그가 있으면 D열에 태그만, 없으면 D열을 비운다.
  // Code.gs의 appendRow_는 빈 제목을 '[지시]'로 채우므로, 공백 한 칸을 보내 D열을 비운다.
  const titleForTarget = (tag) => (inAiChat() ? (tag === NO_TAG || !tag ? ' ' : tag) : titleForTag(tag));

  const MEMBER_STYLE = {
    '라운': { emoji: '👑', color: '#FEE500', ink: '#3d3200' },
    'muse': { emoji: '🎭', color: '#5B4BD6' },
    'muse (a사단 사단장)': { emoji: '🎭', color: '#5B4BD6' },
    'muse (b사단장)': { emoji: '🎭', color: '#5B4BD6' },
    'muse (사단장)': { emoji: '🎭', color: '#5B4BD6' },
    '피클': { emoji: '🥒', color: '#2E9E5B' },
    '피클-b': { emoji: '🥒', color: '#2E9E5B' },
    'muse-b': { emoji: '🎭', color: '#5B4BD6' },
    '부이': { emoji: '🐣', color: '#E8A11B' },
    '부이-b': { emoji: '🐣', color: '#E8A11B' },
    'hark-b': { emoji: '🦉', color: '#3D6B99' },
    '뀨': { emoji: '🐰', color: '#C2569B' },
    '뀨-b': { emoji: '🐰', color: '#C2569B' },
    '키링': { emoji: '🔑', color: '#8A6A3D' },
    '키링-b': { emoji: '🔑', color: '#8A6A3D' },
    'instinct': { emoji: '⚡', color: '#D9480F' },
    'pally': { emoji: '🕊', color: '#5F7E9E' },
    'grok': { emoji: '🌀', color: '#4B5563' },
    'claude': { emoji: '🧠', color: '#B45309' },
    'gemini': { emoji: '✨', color: '#2563EB' }
  };
  const AVATAR_COLORS = ['#5B4BD6', '#2E9E5B', '#E8A11B', '#3D6B99', '#C2569B', '#D9480F', '#8A6A3D', '#0E7490'];

  const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  // 첨부 제한 — google.script.run으로 한 번에 보내는 양이 너무 커지지 않게 막는다.
  const MAX_ATTACH_FILE = 15 * 1024 * 1024;
  const MAX_ATTACH_TOTAL = 20 * 1024 * 1024;
  const SEND_ICON = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 11.5 20 4l-7.5 16-2.2-6.3L4 11.5z" fill="currentColor"/></svg>';

  /* ───────── 상태 ───────── */
  // 오피스 테마 스킨은 브라우저에 기억해 둔다(없으면 데이라이트).
  function loadStoredSkin() {
    try {
      const s = localStorage.getItem('sadan.talk.skin.v1');
      return (s === 'sakura' || s === 'night') ? s : 'day';
    } catch (e) { return 'day'; }
  }

  const state = {
    config: loadConfig(),
    view: 'rooms',
    roomId: 'all',
    filter: 'all',
    tabFilter: null,          // null = 주요 탭
    query: '',
    searchOpen: false,
    msgs: [],                 // 현재 방 메시지
    rooms: {},                // roomId -> {msgs, at}
    target: loadTarget(),
    targetKind: 'unknown',
    tag: '@전체',
    tabsBySheet: {},          // sheetKey -> [{title,gid,lastRow}]
    attach: [],               // 전송 대기 중인 첨부 [{file,name,size,mime,thumb}]
    uploading: false,         // 첨부 업로드 진행 중
    loading: false,
    unread: {},
    pendingNew: 0,
    skin: loadStoredSkin(),     // 오피스 테마: day · sakura · night
    officeSnap: null,
    // 🔀 워크플로우 화면 상태 — 기간·검색어·선택한 노드·팬/줌
    wf: { period: 'all', q: '', sel: null, view: null, open: false, fitted: false }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ───────── 설정 ───────── */
  function loadConfig() {
    const base = { gasUrl: '', token: '', demo: true, pollSec: 30, author: '라운' };
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      const cfg = Object.assign(base, raw);
      if (!cfg.gasUrl) cfg.demo = true;
      return cfg;
    } catch (e) { return base; }
  }
  function saveConfig(patch) {
    state.config = Object.assign({}, state.config, patch);
    if (!state.config.gasUrl) state.config.demo = true;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(state.config)); } catch (e) { /* 저장 차단 환경 */ }
    window.dispatchEvent(new CustomEvent('sadan:config'));
  }
  function loadTarget() {
    try {
      const t = JSON.parse(localStorage.getItem(TARGET_KEY) || 'null');
      if (t && t.sheet && t.tab) return t;
    } catch (e) { /* ignore */ }
    return { sheet: 'b', tab: '시트1' };
  }
  function saveTarget(t) {
    state.target = t;
    try { localStorage.setItem(TARGET_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ }
  }

  // 방에 기본 전송 대상이 있는 경우(예: AI 채팅방 → A시트 ai채팅),
  // 그 방에 들어갈 때 대상을 바꾸고 나올 때 사용자가 쓰던 대상으로 돌려놓는다.
  // (바꾼 채로 두면 B사단 방에서 보낸 지시가 ai채팅으로 들어갈 수 있다.)
  let targetBeforeRoom = null;
  function applyRoomTarget(room) {
    const cur = { sheet: state.target.sheet, tab: state.target.tab };
    const want = room && room.target;
    if (want) {
      if (cur.sheet === want.sheet && cur.tab === want.tab) return;
      targetBeforeRoom = cur;
      saveTarget({ sheet: want.sheet, tab: want.tab });
    } else {
      if (!targetBeforeRoom) return;
      const back = targetBeforeRoom;
      targetBeforeRoom = null;
      if (back.sheet === cur.sheet && back.tab === cur.tab) return;
      saveTarget(back);
    }
    syncComposer();
    refreshTargetKind();
  }
  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSeen(map) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ } }

  let seen = loadSeen();

  /* ───────── API ───────── */
  const api = {
    isLive() { return !!window.SADAN_GAS_MODE || !!(state.config.gasUrl && !state.config.demo); },

    async tabs(sheetKey) {
      if (state.tabsBySheet[sheetKey]) return state.tabsBySheet[sheetKey];
      if (!this.isLive()) {
        const s = (window.SADAN_DEMO && window.SADAN_DEMO.sheets || {})[sheetKey];
        const tabs = s ? (s.tabs || []) : [];
        const all = s ? (s.allTabs || tabs) : [];
        state.tabsBySheet[sheetKey] = tabs;
        state.tabsAll = state.tabsAll || {};
        state.tabsAll[sheetKey] = all;
        return tabs;
      }
      const data = await this.call({ action: 'tabs', sheet: sheetKey });
      const tabs = (data.tabs || []).map(t => ({ title: t.title, gid: t.gid, lastRow: t.lastRow }));
      state.tabsBySheet[sheetKey] = tabs;
      state.tabsAll = state.tabsAll || {};
      state.tabsAll[sheetKey] = tabs;
      try { localStorage.setItem(TABS_CACHE_KEY, JSON.stringify(Object.assign({}, state.tabsAll, { _at: Date.now() }))); } catch (e) {}
      return tabs;
    },

    async allTabs(sheetKey) {
      await this.tabs(sheetKey);
      const cached = state.tabsAll && state.tabsAll[sheetKey];
      if (cached && cached.length) return cached;
      if (window.SADAN_DEMO && window.SADAN_DEMO.sheets[sheetKey]) return window.SADAN_DEMO.sheets[sheetKey].allTabs || [];
      return state.tabsBySheet[sheetKey] || [];
    },

    async read(sheetKey, tabs, limit = 60) {
      if (!tabs || !tabs.length) return [];
      if (!this.isLive()) return demoRead(sheetKey, tabs);
      const data = await this.call({ action: 'read', sheet: sheetKey, tabs: tabs.join('|'), limit });
      if (data.demo) return [];
      const out = [];
      Object.keys(data.rows || {}).forEach(tab => {
        (data.rows[tab] || []).forEach(r => out.push(normalize(r, sheetKey, tab)));
      });
      return out;
    },

    async append({ sheet, tab, title, body, author, tag, link }) {
      if (!this.isLive()) {
        const local = { sheet, tab, title, body, author, t: nowStamp(), demo: true };
        return { ok: true, demo: true, message: local };
      }
      const data = await this.call({ action: 'append', sheet, tab, title, body, author, tag, link });
      return data;
    },

    // 첨부파일 1건을 Drive에 올리고 링크를 받는다. (데모 모드에서는 가짜 주소)
    async upload({ name, mimeType, dataBase64 }) {
      if (!this.isLive()) {
        const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return {
          ok: true, demo: true, id: 'demo-' + stamp, name: name,
          url: 'https://drive.google.com/file/d/demo-' + stamp + '/view',
          mimeType: mimeType, size: 0
        };
      }
      return this.call({ action: 'upload', name, mimeType, dataBase64 });
    },

    async call(payload) {
      const withToken = Object.assign({}, payload, { token: state.config.token || '' });
      // GAS 단독 배포(app.html)에서는 google.script.run으로 같은 스크립트를 부른다.
      if (window.SADAN_GAS_MODE) return this.callGas(withToken);

      const url = state.config.gasUrl;
      if (!url) throw new Error('Apps Script 웹앱 URL이 없습니다.');
      if (payload.action === 'read' || payload.action === 'tabs') {
        const q = new URLSearchParams(withToken);
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + q.toString(), {
          method: 'GET', redirect: 'follow', cache: 'no-store'
        });
        return unwrap(await res.text());
      }
      // POST는 CORS 프리플라이트를 피하려고 text/plain으로 보낸다(GAS 규약).
      const res = await fetch(url, {
        method: 'POST', redirect: 'follow', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(withToken)
      });
      return unwrap(await res.text());
    },

    async ping() {
      if (!this.isLive()) return { ok: true, demo: true };
      return this.call({ action: 'ping' });
    },

    async info(sheetKey, tab) {
      if (!this.isLive()) {
        const demo = window.SADAN_DEMO || {};
        const perSheet = ((demo.sheets || {})[sheetKey] || {}).kinds || (demo.kinds || {})[sheetKey] || (demo.kinds || {});
        return { ok: true, tab, kind: perSheet[tab] || 'unknown' };
      }
      return this.call({ action: 'info', sheet: sheetKey, tab });
    },

    callGas(payload) {
      return new Promise((resolve, reject) => {
        if (!(window.google && window.google.script && window.google.script.run)) {
          reject(new Error('Apps Script 실행 환경이 아닙니다.'));
          return;
        }
        window.google.script.run
          .withSuccessHandler((txt) => {
            try { resolve(unwrap(typeof txt === 'string' ? txt : JSON.stringify(txt))); }
            catch (e) { reject(e); }
          })
          .withFailureHandler((err) => reject(new Error((err && err.message) || 'Apps Script 오류')))
          .apiCall(JSON.stringify(payload));
      });
    }
  };

  function unwrap(text) {
    let j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error('서버 응답을 읽지 못했습니다. 배포 URL(/exec)과 액세스 권한(모든 사용자)을 확인하세요.'); }
    if (j && j.ok === false) throw new Error(j.error || '서버 오류');
    return j;
  }

  function demoRead(sheetKey, tabs) {
    const rows = (window.SADAN_DEMO && window.SADAN_DEMO.rows) || {};
    const out = [];
    tabs.forEach(tab => {
      (rows[sheetKey + '|' + tab] || []).forEach((r, i) => {
        out.push(normalize(Object.assign({ tab }, r, { row: 0, idx: i }), sheetKey, tab));
      });
    });
    return out;
  }

  function cleanAuthor(raw) {
    let s = String(raw || '').trim();
    const written = s.match(/작성\s*[:：]\s*([^\n]{1,30})/);
    if (written) s = written[1].trim();
    s = s.replace(/[;,。]\s*$/, '');
    if (s.length > 22) s = s.slice(0, 22) + '…';
    return s || '미상';
  }

  function normalize(r, sheetKey, tab) {
    const t = String(r.t || r.time || '').trim();
    const m = {
      sheet: sheetKey,
      tab,
      tabLabel: tab,
      row: r.r || r.row || 0,
      timeText: t,
      ts: parseStamp(t),
      title: String(r.title || '').trim(),
      body: String(r.body || '').trim(),
      link: String(r.link || '').trim(),
      author: cleanAuthor(r.author)
    };
    m.key = sheetKey + '|' + tab + '|' + (m.row || m.ts + '|' + m.title.slice(0, 24));
    return m;
  }

  /* ───────── 시간 ───────── */
  function parseStamp(s) {
    if (!s) return 0;
    const m = String(s).match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (!m) return 0;
    const y = +m[1], mo = +m[2], d = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0);
    // 시트 시간은 KST 표기
    return Date.UTC(y, mo - 1, d, h - 9, mi);
  }
  function nowStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} KST`;
  }
  function fmtClock(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    let h = d.getHours();
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ampm = h < 12 ? '오전' : '오후';
    h = h % 12 || 12;
    return `${ampm} ${h}:${mi}`;
  }
  function fmtDay(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_KO[d.getDay()]}요일`;
  }
  function fmtRoomTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const sameDay = d.toDateString() === n.toDateString();
    if (sameDay) return fmtClock(ts).replace(' ', ' ');
    const yd = new Date(n.getTime() - 864e5);
    if (d.toDateString() === yd.toDateString()) return '어제';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  /* ───────── 메시지 분류 ───────── */
  const isMine = a => /라운/.test(a) || a === state.config.author;
  const isCommander = a => /사단장|^Muse\b|^Muse$/.test(a.trim());

  function typeOf(m) {
    if (isMine(m.author)) return 'instruction';
    const title = m.title;
    if (isCommander(m.author) && /지시|요청|루틴|공지|점검|흡수|안내/.test(title)) return 'instruction';
    if (/^\[(지시|공통 지시|긴급|라운)/.test(title) && isCommander(m.author)) return 'instruction';
    return 'report';
  }

  function instrNums(title) {
    const out = [];
    const re = /지시\s*(\d{1,3})/g;
    let m;
    while ((m = re.exec(title))) out.push(m[1]);
    return out;
  }

  function annotate(msgs) {
    // 탭별로 시간순 정렬 후 지시 이행 여부 계산
    const byTab = new Map();
    msgs.forEach(m => {
      m.type = typeOf(m);
      const k = m.sheet + '|' + m.tab;
      if (!byTab.has(k)) byTab.set(k, []);
      byTab.get(k).push(m);
    });
    byTab.forEach(list => {
      list.sort((a, b) => a.ts - b.ts);
      list.forEach(m => { m.status = m.type === 'instruction' ? 'wait' : 'done'; });
      list.forEach(m => {
        if (m.type !== 'instruction') {
          const t = m.title;
          if (/완료|성공/.test(t)) m.status = 'done';
          else if (/진행|착수|시작|중간|보류|지연/.test(t)) m.status = 'progress';
          else if (/보고|점검|수행|기록|결과|답변|회신|정리/.test(t)) m.status = 'done';
          else m.status = 'unknown';
          return;
        }
        const nums = instrNums(m.title);
        if (!nums.length) {
          // 번호 없는 지시 — 24시간 지나면 미확인
          m.status = (Date.now() - (m.ts || 0) > 864e5) ? 'unknown' : 'wait';
          return;
        }
        let refs = list.filter(x => x !== m && x.ts >= m.ts &&
          nums.some(n => new RegExp('지시\\s*' + n + '(?!\\d)').test(x.title)));
        if (!refs.length) { m.status = (Date.now() - (m.ts || 0) > 864e5) ? 'unknown' : 'wait'; return; }
        const done = refs.some(x => /완료|이행|처리했습니다|적용/.test(x.title));
        m.status = done ? 'done' : 'progress';
      });
    });
    return msgs;
  }

  const STATUS_LABEL = { done: '완료', progress: '진행중', wait: '대기', unknown: '미확인' };

  /* ───────── 멤버 스타일 ───────── */
  function memberStyle(author) {
    const raw = author.trim();
    const k = raw.toLowerCase();
    if (MEMBER_STYLE[k]) return MEMBER_STYLE[k];
    const base = raw.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (MEMBER_STYLE[base]) return MEMBER_STYLE[base];
    let h = 0;
    for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
    return { emoji: '', color: AVATAR_COLORS[h % AVATAR_COLORS.length], initial: author.slice(0, 1) };
  }

  /* ───────── 방 데이터 ───────── */
  function roomById(id) { return ROOMS.find(r => r.id === id) || ROOMS[0]; }

  function activeTabs(room) {
    if (state.tabFilter) {
      const [sk, tab] = state.tabFilter.split('|');
      const src = room.sources.find(s => s.sheet === sk);
      if (src) return [{ sheet: sk, tabs: [tab] }];
      return [{ sheet: sk, tabs: [tab] }];
    }
    return room.sources;
  }

  async function loadRoom(room, opts = {}) {
    const limit = opts.limit || 80;
    const groups = activeTabs(room);
    const chunks = await Promise.all(groups.map(g =>
      api.read(g.sheet, g.tabs, limit)
        .then(list => ({ ok: true, list }))
        .catch(err => { console.warn(err); return { ok: false, err }; })
    ));
    // 모두 실패했으면 '기록 없음'으로 그리지 말고 오류를 올린다(성공한 응답이 하나도 없을 때만).
    if (groups.length && chunks.every(c => !c.ok)) {
      const err = (chunks.find(c => !c.ok) || {}).err;
      throw new Error((err && err.message) || '시트를 읽지 못했습니다.');
    }
    let msgs = [].concat.apply([], chunks.filter(c => c.ok).map(c => c.list));
    const seenKeys = new Set();
    msgs = msgs.filter(m => { if (seenKeys.has(m.key)) return false; seenKeys.add(m.key); return true; });
    msgs.sort((a, b) => a.ts - b.ts || String(a.row).localeCompare(String(b.row)));
    annotate(msgs);
    state.rooms[room.id] = { msgs, at: Date.now() };
    // 오피스와 워크플로우는 같은 시트를 읽는다 — 한 번 받은 기록을 둘이 나눠 쓴다.
    if (room.kind === 'office' && state.rooms.workflow) state.rooms.workflow = state.rooms.office;
    if (room.kind === 'workflow') state.rooms.office = state.rooms.workflow;
    return msgs;
  }

  async function ensureRoom(roomId) {
    const room = roomById(roomId);
    if (!state.rooms[room.id]) await loadRoom(room, { limit: 40 });
    return state.rooms[room.id].msgs;
  }

  /* ───────── 렌더: 방 목록 ───────── */
  function renderRooms() {
    const list = $('#roomList');
    list.innerHTML = '';
    const q = ($('#roomSearch').value || '').trim().toLowerCase();
    ROOMS.filter(r => !q || r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)).forEach(room => {
      const data = state.rooms[room.id];
      const msgs = data ? data.msgs : [];
      const last = msgs[msgs.length - 1];
      const btn = el('button', 'room' + (room.id === state.roomId ? ' active' : ''));
      btn.type = 'button';
      btn.setAttribute('role', 'listitem');

      const av = el('div', 'room-avatar', room.emoji);
      av.style.background = `linear-gradient(160deg, ${room.color}, ${shade(room.color, -18)})`;
      btn.appendChild(av);

      const body = el('div', 'room-body');
      const top = el('div', 'room-top');
      top.appendChild(el('span', 'room-name', room.name));
      const ofc = room.kind === 'office' ? officeSnapshot(msgs) : null;
      const wfp = room.kind === 'workflow' && data ? wfParse(msgs) : null;
      const wfModelMini = wfp ? wfModel(wfp) : null;
      const nBot = wfModelMini ? wfModelMini.bots.filter(b => b.count > 0).length : 0;
      const nChan = wfModelMini ? wfModelMini.chans.filter(c => c.count > 0).length : 0;
      top.appendChild(el('span', 'room-count', ofc ? ofc.counts.total + '명' : (wfp ? wfp.length + '건' : `${msgs.length}건`)));
      top.appendChild(el('span', 'room-time', last ? fmtRoomTime(last.ts) : ''));
      body.appendChild(top);

      const prev = el('div', 'room-preview');
      if (ofc) {
        prev.appendChild(el('span', '', '열일 ' + ofc.counts.working + ' · 활동 ' + ofc.counts.active + ' · 대기 ' + ofc.counts.waiting + ' · 휴식 ' + ofc.counts.idle));
      } else if (wfp) {
        prev.appendChild(el('span', '', '게시·출고 ' + wfp.length + '건 · 봇 ' + nBot + ' · 채널 ' + nChan));
      } else if (last) {
        const tag = el('span', 'room-tabtag', (room.id === 'all' ? SHEETS[last.sheet].short + '·' : '') + last.tab);
        prev.appendChild(tag);
        prev.appendChild(el('span', '', last.title || last.body.slice(0, 40)));
      } else {
        prev.appendChild(el('span', '', data ? '기록 없음' : '불러오는 중…'));
      }
      const unseen = msgs.filter(m => m.ts > (seen[room.id] || 0)).length;
      if (unseen > 0) prev.appendChild(el('span', 'room-badge', String(unseen)));
      body.appendChild(prev);
      btn.appendChild(body);

      btn.addEventListener('click', () => openRoom(room.id));
      list.appendChild(btn);
    });
  }

  function shade(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  /* ───────── 렌더: 채팅 ───────── */
  function openRoom(id) {
    const room = roomById(id);
    state.roomId = id;
    applyRoomTarget(room);
    state.tabFilter = null;
    state.query = '';
    state.searchOpen = false;
    $('#searchBar').hidden = true;
    $('#msgSearch').value = '';
    state.view = room.kind === 'office' ? 'office' : (room.kind === 'workflow' ? 'workflow' : 'chat');
    if (state.view === 'workflow') state.wf.fitted = false;
    $('#app').dataset.view = state.view;
    syncOfficeVisible();
    renderRooms();
    renderChatHead();
    if (state.view === 'office') renderOffice();
    else if (state.view === 'workflow') renderWorkflow();
    else renderMessages();
    markSeen(id);
    if (state.view === 'chat') scrollToBottom(true);
    if (api.isLive()) refresh({ silent: true });
  }

  function renderChatHead() {
    const room = roomById(state.roomId);
    $('#chatName').textContent = room.name;
    const tabs = state.tabFilter ? state.tabFilter.split('|')[1] : null;
    if (room.kind === 'office') {
      const s = state.officeSnap;
      $('#chatSub').textContent = s
        ? s.counts.total + '명 · 열일 ' + s.counts.working + ' · 활동 ' + s.counts.active + ' · 대기 ' + s.counts.waiting + ' · 휴식 ' + s.counts.idle
        : room.desc;
      $('#tabFilterLabel').textContent = '근무 현황';
      return;
    }
    if (room.kind === 'workflow') {
      $('#chatSub').textContent = room.desc + ' — 시트 기록에서 자동으로';
      $('#tabFilterLabel').textContent = '게시 흐름';
      return;
    }
    $('#chatSub').textContent = tabs ? `${tabs} 탭 · ${room.desc}` : room.desc;
    $('#tabFilterLabel').textContent = tabs ? `${tabs}` : '주요 탭';
  }

  function currentMsgs() {
    const data = state.rooms[state.roomId];
    let msgs = data ? data.msgs : state.msgs;
    if (state.tabFilter) {
      const tab = state.tabFilter.split('|')[1];
      msgs = msgs.filter(m => m.tab === tab);
    }
    if (state.query) {
      const q = state.query.toLowerCase();
      msgs = msgs.filter(m => (m.title + ' ' + m.body + ' ' + m.author + ' ' + m.tab).toLowerCase().includes(q));
    }
    return msgs;
  }

  function filtered(msgs) {
    if (state.filter === 'instruction') return msgs.filter(m => m.type === 'instruction');
    if (state.filter === 'report') return msgs.filter(m => m.type === 'report');
    if (state.filter === 'todo') {
      return msgs.filter(m => (m.type === 'instruction' && m.status !== 'done') ||
        (m.type === 'report' && m.status === 'progress'));
    }
    return msgs;
  }

  function renderMessages() {
    const box = $('#messages');
    const all = currentMsgs();
    const msgs = filtered(all);
    box.innerHTML = '';

    // 필터 카운트
    const base = state.query || state.tabFilter ? all : all;
    const counts = {
      instruction: base.filter(m => m.type === 'instruction').length,
      report: base.filter(m => m.type === 'report').length,
      todo: base.filter(m => (m.type === 'instruction' && m.status !== 'done') || (m.type === 'report' && m.status === 'progress')).length
    };
    document.querySelectorAll('[data-count]').forEach(n => { n.textContent = counts[n.dataset.count] || 0; });
    document.querySelectorAll('#filters .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === state.filter));

    if (!msgs.length) {
      const empty = el('div', 'empty');
      empty.appendChild(el('div', 'big', '💬'));
      const b = el('div');
      b.innerHTML = state.query ? '<b>검색 결과가 없습니다.</b><br>다른 단어로 찾아보세요.' :
        (state.filter !== 'all' ? '<b>조건에 맞는 기록이 없습니다.</b><br>필터를 “전체”로 바꿔보세요.' :
          '<b>아직 표시할 기록이 없습니다.</b><br>아래 입력창에서 첫 지시를 보내보세요.');
      empty.appendChild(b);
      box.appendChild(empty);
    }

    let lastDay = '', prev = null;
    msgs.forEach((m, i) => {
      const day = new Date(m.ts || Date.now()).toDateString();
      if (day !== lastDay) {
        const d = el('div', 'date-divider');
        d.appendChild(el('span', '', fmtDay(m.ts || Date.now())));
        box.appendChild(d);
        lastDay = day;
        prev = null;
      }
      const grouped = prev && prev.author === m.author && prev.tab === m.tab && (m.ts - prev.ts) < 6e5;
      box.appendChild(renderMsg(m, grouped, msgs));
      prev = m;
    });

    if (msgs.length) {
      const note = el('div', 'chat-foot-note');
      const live = api.isLive();
      note.textContent = live
        ? '시트에 기록된 지시·보고를 그대로 보여줍니다. 앱에서 보낸 지시는 선택한 탭 마지막 행에 바로 기록됩니다.'
        : '데모 모드 — 실제 시트 최근 행(축약)을 보여줍니다. 설정에서 Apps Script URL을 연결하면 실제 기록으로 바뀝니다.';
      box.appendChild(note);
    }
    if (state.searchOpen) updateSearchCount(all);
  }

  function renderMsg(m, grouped, all) {
    const wrap = el('div', 'msg' + (grouped ? ' grouped' : '') + (isMine(m.author) ? ' mine' : ''));

    const mine = isMine(m.author);
    const av = el('div', 'avatar' + (grouped || mine ? ' empty' : ''));
    const st = memberStyle(m.author);
    if (!grouped && !mine) {
      av.style.background = st.color;
      if (st.ink) av.style.color = st.ink;
      av.textContent = st.emoji || st.initial || m.author.slice(0, 1);
      av.title = m.author;
    }
    wrap.appendChild(av);

    const body = el('div', 'msg-body');

    if (!grouped) {
      const meta = el('div', 'msg-meta');
      meta.appendChild(el('span', 'who', m.author));
      if (m.type === 'instruction') meta.appendChild(el('span', 'from', '지시'));
      meta.appendChild(el('span', 'bubble-tab', SHEETS[m.sheet].short + '·' + m.tab));
      body.appendChild(meta);
    }

    const bubble = el('div', 'bubble');
    if (m.title) bubble.appendChild(el('div', 'title', m.title));
    const bodyText = m.body || '';
    if (bodyText) {
      const b = el('div', 'body');
      b.innerHTML = bodyHtml(bodyText);
      bubble.appendChild(b);
      if (bodyText.length > 260) {
        b.classList.add('collapsed');
        const more = el('button', 'more', '더보기');
        more.type = 'button';
        more.addEventListener('click', () => {
          const on = b.classList.toggle('collapsed');
          more.textContent = on ? '더보기' : '접기';
        });
        bubble.appendChild(more);
        // 실제로 잘린 경우에만 버튼을 남긴다 (짧은 글이면 숨김)
        requestAnimationFrame(() => {
          if (b.scrollHeight && b.scrollHeight <= b.clientHeight + 6) more.remove();
        });
      }
    }
    body.appendChild(bubble);

    const foot = el('div', 'bubble-foot');
    // AI 채팅방은 지시·보고가 아니라 대화라서 상태 배지(완료/진행중…) 없이 시각만 보여준다.
    const chatRoom = state.roomId === 'aichat';
    if (!chatRoom && !(m.type === 'report' && m.status === 'unknown')) {
      foot.appendChild(el('span', 'badge ' + m.status, STATUS_LABEL[m.status] || ''));
    }
    foot.appendChild(el('span', 'mine-mark', fmtClock(m.ts)));
    if (m.row) {
      const a = el('a', 'sheet-link', '시트 ' + m.row + '행');
      a.href = sheetUrl(m);
      a.target = '_blank';
      a.rel = 'noopener';
      foot.appendChild(a);
    }
    body.appendChild(foot);
    wrap.appendChild(body);
    return wrap;
  }

  // 주의: Apps Script HTML 서비스는 템플릿 리터럴(백틱) 안의 "//"를 줄 주석으로 지워 버린다.
  // 그래서 URL은 템플릿 리터럴이 아니라 문자열 연결로 만든다(2026-11-26 설정 창이 안 열린 원인).
  function sheetUrl(m) {
    const s = SHEETS[m.sheet];
    const gid = gidOf(m.sheet, m.tab);
    return 'https://docs.google.com/spreadsheets/d/' + s.id + '/edit#gid=' + (gid || 0) + '&range=A' + m.row;
  }
  function gidOf(sheetKey, tab) {
    const list = (state.tabsAll && state.tabsAll[sheetKey]) || state.tabsBySheet[sheetKey] || [];
    const t = list.find(x => x.title === tab);
    return t ? t.gid : 0;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function linkify(text) {
    const esc = escapeHtml(text);
    return esc.replace(/(https?:\/\/[^\s<>"']+)/g, u => {
      const clean = u.replace(/[.,;:!?)]+$/, '');
      const tail = u.slice(clean.length);
      return '<a href="' + clean + '" target="_blank" rel="noopener">' + clean + '</a>' + tail;
    });
  }

  // 본문 안의 첨부 줄(`📎 [이름](url)` 또는 `📎 이름` + 다음 줄 url)을 누를 수 있는 카드로 그린다(카톡의 파일 말풍선과 비슷하게).
  function bodyHtml(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const md = line.match(/^\s*📎\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/);
      if (md) { out.push(attachCardHtml(md[1], md[2])); continue; }
      const bare = line.match(/^\s*📎\s+(\S.*)$/);
      if (bare && i + 1 < lines.length && /^https?:\/\/\S+$/.test(lines[i + 1].trim())) {
        out.push(attachCardHtml(bare[1].trim(), lines[i + 1].trim()));
        i++;
        continue;
      }
      out.push(linkify(line));
    }
    return out.join('\n');
  }

  function attachCardHtml(name, url) {
    return '<a class="attach-card" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
      '<span class="ac-ico">' + fileIcon(name, '') + '</span>' +
      '<span class="ac-name">' + escapeHtml(name) + '</span>' +
      '<span class="ac-go">열기</span></a>';
  }

  function fileIcon(name, mime) {
    const t = String(mime || '').toLowerCase();
    const m = String(name || '').match(/\.([a-z0-9]+)$/i);
    const e = m ? m[1].toLowerCase() : '';
    if (t.indexOf('image/') === 0 || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'svg'].indexOf(e) >= 0) return '🖼️';
    if (t.indexOf('video/') === 0 || ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].indexOf(e) >= 0) return '🎬';
    if (t === 'application/pdf' || e === 'pdf') return '📄';
    if (['zip', '7z', 'tar', 'gz'].indexOf(e) >= 0) return '🗜️';
    if (['doc', 'docx', 'hwp', 'hwpx', 'txt', 'md', 'rtf'].indexOf(e) >= 0) return '📝';
    if (['xls', 'xlsx', 'csv', 'numbers'].indexOf(e) >= 0) return '📊';
    if (['ppt', 'pptx', 'key'].indexOf(e) >= 0) return '📽️';
    if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].indexOf(e) >= 0) return '🎵';
    return '📎';
  }

  function fmtSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + 'B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0) + 'KB';
    return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
  }

  function updateSearchCount(list) {
    const n = list.length;
    $('#searchCount').textContent = state.query ? `${n}건` : '';
  }

  function scrollToBottom(force) {
    const box = $('#messages');
    requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
      if (force) $('#jumpNew').hidden = true;
    });
  }

  function markSeen(id) {
    const data = state.rooms[id];
    const last = data && data.msgs.length ? data.msgs[data.msgs.length - 1].ts : Date.now();
    seen[id] = Math.max(seen[id] || 0, last || Date.now());
    saveSeen(seen);
    renderRooms();
  }

  /* ───────── 오피스 (사단 2.5D 아이소메트릭 디오라마) ───────── */
  // 근무 상태 — 30분 안 = 🔥 열일중, 2시간 안 = 💻 작업함, 그 밖 = ☕ 대기, 기록 없음 = 💤 휴식(라운지로 이동)
  const OFC_WORK_MS = 30 * 60e3;
  const OFC_ACTIVE_MS = 120 * 60e3;
  const OFC_SKIN_KEY = 'sadan.talk.skin.v1';
  const OFC_SKINS = [
    { id: 'day', icon: '☀️', name: '데이라이트' },
    { id: 'sakura', icon: '🌸', name: '벚꽃 라운지' },
    { id: 'night', icon: '🌙', name: '나이트 오피스' }
  ];

  // 등각(2:1) 좌표 — 타일 한 칸 = 가로 64px · 세로 32px
  const OFC_TW = 64, OFC_TH = 32;
  const OFC_GW = 17, OFC_GH = 15;
  const OFC_SCENE_W = 1060, OFC_SCENE_H = 764;
  const OFC_OX = 500, OFC_OY = 232;
  const OFC_WALL_H = 214;

  function iso(gx, gy) {
    return [(gx - gy) * OFC_TW / 2 + OFC_OX, (gx + gy) * OFC_TH / 2 + OFC_OY];
  }
  function isoP(gx, gy, up) {
    const p = iso(gx, gy);
    return p[0].toFixed(1) + ',' + (p[1] - (up || 0)).toFixed(1);
  }
  function isoPoly(pts, cls, attrs) {
    return '<polygon class="' + cls + '" points="' + pts.join(' ') + '"' + (attrs || '') + '/>';
  }
  // 등각 상자 — 윗면 · 앞면(왼쪽) · 옆면(오른쪽). cls로 색 계열(tone-*)을 고른다.
  function box3d(x, y, w, d, h, tone, cls) {
    return '<g class="bx tone-' + tone + (cls ? ' ' + cls : '') + '">' +
      isoPoly([isoP(x, y, h), isoP(x + w, y, h), isoP(x + w, y + d, h), isoP(x, y + d, h)], 'bx-top') +
      isoPoly([isoP(x, y + d, h), isoP(x + w, y + d, h), isoP(x + w, y + d, 0), isoP(x, y + d, 0)], 'bx-face') +
      isoPoly([isoP(x + w, y, h), isoP(x + w, y + d, h), isoP(x + w, y + d, 0), isoP(x + w, y, 0)], 'bx-side') +
      '</g>';
  }

  // 고정 명단. 여기에 없는 이름이 시트에 나타나면 officeSnapshot이 자리를 새로 만든다.
  const OFFICE_FIXED = [
    { id: 'ceo', name: '라운 사장님', emoji: '👑', role: '사장님 · 대표', zone: 'ceo', side: '', color: '#F59E0B' },
    { id: 'a-muse', name: 'A-Muse', emoji: '🎭', role: 'A사단장', zone: 'a', side: 'a', lead: true, color: '#5B4BD6' },
    { id: 'b-muse', name: 'B-Muse', emoji: '🎭', role: 'B사단장', zone: 'b', side: 'b', lead: true, color: '#7C5CFF' },
    { id: 'a-pickle', name: '피클', emoji: '🥒', role: 'A사단 · 피클', zone: 'a', side: 'a', color: '#2E9E5B' },
    { id: 'a-booi', name: '부이', emoji: '🐣', role: 'A사단 · 부이', zone: 'a', side: 'a', color: '#E8A11B' },
    { id: 'a-instinct', name: 'Instinct', emoji: '⚡', role: 'A사단 · 인스팅트', zone: 'a', side: 'a', color: '#D9480F' },
    { id: 'a-pally', name: 'Pally', emoji: '🕊', role: 'A사단 · 팔리', zone: 'a', side: 'a', color: '#5F7E9E' },
    { id: 'a-kkyu', name: '뀨', emoji: '🐰', role: 'A사단 · 뀨', zone: 'a', side: 'a', color: '#C2569B' },
    { id: 'a-keyring', name: '키링', emoji: '🔑', role: 'A사단 · 키링', zone: 'a', side: 'a', color: '#8A6A3D' },
    { id: 'b-pickle', name: '피클-B', emoji: '🥒', role: 'B사단 · 피클', zone: 'b', side: 'b', color: '#2E9E5B' },
    { id: 'b-booi', name: '부이-B', emoji: '🐣', role: 'B사단 · 부이', zone: 'b', side: 'b', color: '#E8A11B' },
    { id: 'b-hark', name: 'Hark-B', emoji: '🦉', role: 'B사단 · 하크', zone: 'b', side: 'b', color: '#3D6B99' },
    { id: 'b-kkyu', name: '뀨-B', emoji: '🐰', role: 'B사단 · 뀨', zone: 'b', side: 'b', color: '#C2569B' },
    { id: 'b-keyring', name: '키링-B', emoji: '🔑', role: 'B사단 · 키링', zone: 'b', side: 'b', color: '#8A6A3D' }
  ];

  // 이름 토큰 → 사단별 자리. 표에 없는 이름은 새 자리로 만든다.
  // (영문 표기·괄호 별칭도 같은 대원으로 묶는다 — 'Pickle'과 '피클'이 두 자리로 갈리지 않게)
  const OFFICE_TOKENS = {
    'muse': { a: 'a-muse', b: 'b-muse' },
    '피클': { a: 'a-pickle', b: 'b-pickle' },
    'pickle': { a: 'a-pickle', b: 'b-pickle' },
    '부이': { a: 'a-booi', b: 'b-booi' },
    'booi': { a: 'a-booi', b: 'b-booi' },
    '뀨': { a: 'a-kkyu', b: 'b-kkyu' },
    'cue': { a: 'a-kkyu', b: 'b-kkyu' },
    '키링': { a: 'a-keyring', b: 'b-keyring' },
    'instinct': { a: 'a-instinct' },
    '인스팅트': { a: 'a-instinct' },
    'pally': { a: 'a-pally' },
    '팔리': { a: 'a-pally' },
    'hark': { b: 'b-hark' },
    '하크': { b: 'b-hark' }
  };

  const OFC_NEW_EMOJI = ['🤖', '🐥', '🦊', '🐼', '🐨', '🦄', '🐙', '🦋', '🐳', '🌱', '🍀', '⭐', '🔮', '🎨', '📚', '🧩', '🕹️', '🦖', '🐧', '🐝'];
  const OFC_NEW_COLOR = ['#0EA5E9', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4'];
  // 탭 이름으로 새 비서를 찾을 때 거르는 작업 탭 이름
  const OFC_TAB_STOP = ['시트', '시트1', 'ai채팅', '채팅', '경험은행', '템플릿', '프로젝트', 'db', 'pod', 'sns', 'ai', 'ppt', 'cta', 'faq', 'url', 'api', 'sop', 'pdf'];

  const OFC_ZONE_NAME = { a: 'A사단 존', b: 'B사단 존', n: '새로 합류', ceo: '사장실', leads: '팀장실' };

  // 대원별 동물 봉제인형 — 사단 구성원은 고유 동물, 새로 합류한 대원은 이름 해시로 배정
  const OFC_ANIMALS = {
    ceo: { kind: 'lion', fur: '#F1C062', label: '사자' },
    'a-muse': { kind: 'cat', fur: '#A99BF2', label: '고양이' },
    'b-muse': { kind: 'cat', fur: '#8878E6', label: '고양이' },
    'a-pickle': { kind: 'otter', fur: '#8ACFA0', label: '수달' },
    'a-booi': { kind: 'chick', fur: '#FFD75C', label: '병아리' },
    'a-instinct': { kind: 'fox', fur: '#F4A05C', label: '여우' },
    'a-pally': { kind: 'bunny', fur: '#C6DDF7', label: '토끼' },
    'a-kkyu': { kind: 'bunny', fur: '#F4A5C8', label: '토끼' },
    'a-keyring': { kind: 'puppy', fur: '#D6A673', label: '포메' },
    'b-pickle': { kind: 'otter', fur: '#77C493', label: '수달' },
    'b-booi': { kind: 'chick', fur: '#FFCE48', label: '병아리' },
    'b-hark': { kind: 'owl', fur: '#93AED3', label: '올빼미' },
    'b-kkyu': { kind: 'bunny', fur: '#EE96C0', label: '토끼' },
    'b-keyring': { kind: 'puppy', fur: '#C8996A', label: '포메' }
  };
  const OFC_DYN_KINDS = ['fox', 'cat', 'bunny', 'puppy', 'bear', 'panda', 'chick', 'otter', 'owl'];
  const OFC_DYN_FUR = ['#F5B183', '#A9C7F0', '#F2A7C3', '#9FD3B0', '#C7B3F0', '#FFD36E', '#9ECFD8', '#E0A98A'];

  function mixHex(hex, to, amt) {
    const a = String(hex || '#888888').replace('#', '');
    const b = String(to || '#FFFFFF').replace('#', '');
    const n = parseInt(a.length === 3 ? a.replace(/(.)/g, '$1$1') : a, 16);
    const m = parseInt(b.length === 3 ? b.replace(/(.)/g, '$1$1') : b, 16);
    if (isNaN(n) || isNaN(m)) return hex || '#888888';
    const mix = (v, w) => Math.round(v + (w - v) * amt);
    return '#' + [mix((n >> 16) & 255, (m >> 16) & 255), mix((n >> 8) & 255, (m >> 8) & 255), mix(n & 255, m & 255)]
      .map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function officeHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function officeAnimal(p) {
    const meta = OFC_ANIMALS[p.id];
    if (meta) return meta;
    const h = officeHash(String(p.name || p.id || 'x'));
    return { kind: OFC_DYN_KINDS[h % OFC_DYN_KINDS.length], fur: OFC_DYN_FUR[h % OFC_DYN_FUR.length], label: '' };
  }

  function officeValidName(name) {
    const s = String(name || '').trim();
    if (!s) return false;
    if (/^(미상|알\s*수\s*없음|알수없음|없음|무명|unknown|n\/a|na|-|–|—|\?+|·+|\.+)$/i.test(s)) return false;
    if (s.length > 12) return false;
    // 시트 본문이 작성자 칸에 잘못 들어간 경우(문장·시간표기)는 사람으로 보지 않는다.
    if (/[:;。!?]/.test(s)) return false;
    if (/\d{4,}/.test(s)) return false;
    if (/^[-–—\s]+$/.test(s)) return false;
    return true;
  }

  // 작성자 문자열 → 명단 id(문자열) 또는 새 자리 정보(객체).
  function officeResolve(author, sheet) {
    const raw = String(author || '').trim();
    if (!raw) return null;
    const paren = (raw.match(/\(([^)]*)\)/) || [])[1] || '';
    const pl = paren.toLowerCase();
    const side = /(^|[^a-z])a\s*사단/.test(pl) ? 'a' : (/(^|[^a-z])b\s*사단/.test(pl) ? 'b' : '');
    let s = raw.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const bSuffix = /(^|[\s_-])b$/.test(s);
    const base = (bSuffix ? s.replace(/[\s_-]*b$/, '') : s).trim();
    if (!base) return null;
    if (/라운|사장|대표/.test(base)) return 'ceo';

    const tok = Object.keys(OFFICE_TOKENS).find(t => base === t || base.indexOf(t + ' ') === 0 || base.indexOf(t + '-') === 0);
    if (tok) {
      const set = OFFICE_TOKENS[tok];
      const pref = side || (bSuffix ? 'b' : '');
      let id = null;
      if (pref) id = set[pref] || null;
      else id = set[sheet] || set.a || set.b || null;
      if (id) return id;
    }

    if (!officeValidName(raw)) return null;
    const zone = side || (sheet === 'b' ? 'b' : sheet === 'a' ? 'a' : 'n');
    const slug = base.replace(/\s+/g, '-').replace(/[^0-9a-z가-힣-]/g, '');
    const h = officeHash(slug || base);
    return {
      dyn: true,
      id: 'x:' + zone + ':' + (slug || 'guest'),
      name: raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(),
      zone: zone,
      emoji: OFC_NEW_EMOJI[h % OFC_NEW_EMOJI.length],
      color: OFC_NEW_COLOR[h % OFC_NEW_COLOR.length]
    };
  }

  // 탭 이름이 '사람 탭'처럼 보이는지 — 작업 탭(예: '겨울꿀템 20')을 대원으로 세우지 않도록.
  function officeTabIsPerson(title) {
    const s = String(title || '').trim();
    if (!s || s.length > 8) return false;
    if (/\s/.test(s)) return false;
    if (/\d/.test(s)) return false;
    if (!/^[A-Za-z가-힣][A-Za-z가-힣-]*$/.test(s)) return false;
    if (!/[A-Za-z]/.test(s)) return false;
    if (OFC_TAB_STOP.indexOf(s.toLowerCase()) >= 0) return false;
    return true;
  }

  function officeStatusOf(p, now) {
    if (!p.last) return 'idle';
    const d = now - p.last.ts;
    if (d <= OFC_WORK_MS) return 'working';
    if (d <= OFC_ACTIVE_MS) return 'active';
    return 'waiting';
  }

  function officeAgo(ts) {
    if (!ts) return '기록 없음';
    const d = Math.max(0, Date.now() - ts);
    if (d < 60e3) return '방금';
    if (d < 3600e3) return Math.floor(d / 60e3) + '분 전';
    if (d < 86400e3) return Math.floor(d / 3600e3) + '시간 전';
    return Math.floor(d / 86400e3) + '일 전';
  }

  // 오피스 명단·상태 계산. 고정 명단 + 시트에서 새로 발견한 작성자/탭 이름을 합친다.
  function officeSnapshot(msgs) {
    const now = Date.now();
    const all = OFFICE_FIXED.map(m => Object.assign({}, m, { dyn: false, count: 0, last: null, recent: [] }));
    const byId = new Map(all.map(m => [m.id, m]));

    (msgs || []).forEach(m => {
      const r = officeResolve(m.author, m.sheet);
      let p = null;
      if (typeof r === 'string') p = byId.get(r) || null;
      else if (r && r.dyn) {
        p = byId.get(r.id) || null;
        if (!p) {
          p = {
            id: r.id, name: r.name, emoji: r.emoji, color: r.color, zone: r.zone,
            role: (r.zone === 'b' ? 'B사단' : r.zone === 'a' ? 'A사단' : '신규') + ' · 새로 합류',
            dyn: true, count: 0, last: null, recent: []
          };
          byId.set(p.id, p);
          all.push(p);
        }
      }
      if (!p) return;
      p.count++;
      p.recent.push(m);
      if (!p.last || m.ts > p.last.ts) p.last = m;
    });

    // 탭 목록에서도 새 AI 비서를 찾는다(아직 오피스가 읽는 탭에 글이 없어도 자리를 만들어 둔다).
    ['b', 'a'].forEach(sk => {
      const tabs = (state.tabsAll && state.tabsAll[sk]) || [];
      tabs.forEach(t => {
        const title = String(t.title || '').trim();
        if (!officeTabIsPerson(title)) return;
        const r = officeResolve(title, sk);
        if (!r || typeof r === 'string' || !r.dyn) return;
        if (byId.has(r.id)) return;
        const p = {
          id: r.id, name: r.name, emoji: r.emoji, color: r.color, zone: 'n', home: r.zone,
          role: (r.zone === 'b' ? 'B사단' : 'A사단') + ' · 새로 합류',
          dyn: true, tabOnly: true, count: 0, last: null, recent: []
        };
        byId.set(p.id, p);
        all.push(p);
      });
    });

    // 탭으로만 알던 비서가 실제로 기록을 남기면 그 사단 자리로 올린다.
    all.forEach(p => {
      if (p.tabOnly && p.count > 0) {
        p.tabOnly = false;
        p.zone = p.home || p.zone;
        p.role = (p.zone === 'b' ? 'B사단' : p.zone === 'a' ? 'A사단' : '신규') + ' · 새로 합류';
      }
    });

    all.forEach(p => {
      p.status = officeStatusOf(p, now);
      p.recent.sort((a, b) => b.ts - a.ts);
    });

    const rank = { working: 0, active: 1, waiting: 2, idle: 3 };
    const sortSeats = (x, y) => (rank[x.status] - rank[y.status]) ||
      ((y.last ? y.last.ts : 0) - (x.last ? x.last.ts : 0)) || x.name.localeCompare(y.name);

    const zones = { ceo: [], a: [], b: [], n: [] };
    const leads = [];
    all.forEach(p => {
      if (p.id === 'ceo') { zones.ceo.push(p); return; }
      if (p.lead) { leads.push(p); return; }
      (zones[p.zone] || zones.n).push(p);
    });
    Object.keys(zones).forEach(k => zones[k].sort(sortSeats));
    // 팀장석은 자리 순서를 고정한다(A-Muse → B-Muse).
    leads.sort((x, y) => OFFICE_FIXED.findIndex(m => m.id === x.id) - OFFICE_FIXED.findIndex(m => m.id === y.id));

    const counts = { total: all.length - 1, working: 0, active: 0, waiting: 0, idle: 0 };
    all.forEach(p => { if (p.id !== 'ceo') counts[p.status]++; });
    return { all, zones, leads, counts, now, ceo: zones.ceo[0] || null };
  }

  function officeMsgs() {
    const data = state.rooms[state.roomId];
    return data ? data.msgs : [];
  }

  // 💤 휴식(idle) 대원은 라운지 소파로 이동한다. 사장님과 아직 합류 전인 탭 비서는 제외.
  function officeAtLounge(p) {
    // 시트를 아직 못 읽었을 때는 모두를 라운지로 보내지 않는다(빈 사무실이 더 자연스럽다).
    return !!p && !p.tabOnly && p.id !== 'ceo' && p.status === 'idle' && officeMsgs().length > 0;
  }

  function officeBadge(p, status) {
    if (p.id === 'ceo') return '👑 사장실';
    if (status === 'working') return '🔥 열일중';
    if (status === 'active') return '💻 작업함';
    if (status === 'waiting') return '☕ 대기';
    return '💤 휴식';
  }
  function officeStatusText(p, status) {
    if (p.id === 'ceo') return '👑 사장실 (사단 전체를 보고 있음)';
    if (status === 'working') return '🔥 열일중 (30분 안에 기록)';
    if (status === 'active') return '💻 작업함 (2시간 안에 기록)';
    if (status === 'waiting') return '☕ 대기 (2시간 넘게 조용함)';
    return '💤 휴식 (기록 없음 · 라운지에서 쉬는 중)';
  }

  /* ── 봉제인형 동물 캐릭터 ── */
  // 좌표계: 가로 150 · 세로 190 (책상 위에 앉은 모습). 머리 중심 (75,46).
  function petSvg(kind, fur, opts) {
    opts = opts || {};
    const light = mixHex(fur, '#FFFFFF', 0.55);
    const pale = mixHex(fur, '#FFFFFF', 0.8);
    const dark = mixHex(fur, '#4A3126', 0.28);
    const deep = mixHex(fur, '#4A3126', 0.5);
    const pink = '#FFB7C5';
    const ink = '#3B2A22';
    const sleep = !!opts.sleep;
    const outline = ' stroke="rgba(74,49,38,.20)" stroke-width="1.1"';
    const white = '#FFFDF8';

    let ears = '';
    let extra = '';
    let headFill = fur;
    let bodyFill = fur;

    if (kind === 'cat') {
      ears = '<path d="M55 31 L48 7 Q48 2 54 7 L69 20 Z" fill="' + fur + '"' + outline + ' stroke-linejoin="round"/>' +
        '<path d="M95 31 L102 7 Q102 2 96 7 L81 20 Z" fill="' + fur + '"' + outline + ' stroke-linejoin="round"/>' +
        '<path d="M57 25 L54 12 L64 20 Z" fill="' + pink + '" opacity=".9"/>' +
        '<path d="M93 25 L96 12 L86 20 Z" fill="' + pink + '" opacity=".9"/>';
      extra = '<path d="M101 94 q17 1 14 -16 q-2 -11 -11 -8" fill="none" stroke="' + fur + '" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M45 54 L31 51 M45 59 L31 61 M105 54 L119 51 M105 59 L119 61" stroke="' + deep + '" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>';
    } else if (kind === 'fox') {
      ears = '<path d="M55 33 L46 2 Q46 -3 53 3 L70 19 Z" fill="' + fur + '"' + outline + ' stroke-linejoin="round"/>' +
        '<path d="M95 33 L104 2 Q104 -3 97 3 L80 19 Z" fill="' + fur + '"' + outline + ' stroke-linejoin="round"/>' +
        '<path d="M57 26 L52 10 L64 19 Z" fill="' + pink + '" opacity=".85"/>' +
        '<path d="M93 26 L98 10 L86 19 Z" fill="' + pink + '" opacity=".85"/>' +
        '<path d="M49 6 L46 2 L53 3 Z" fill="' + deep + '"/><path d="M101 6 L104 2 L97 3 Z" fill="' + deep + '"/>';
      extra = '<path d="M99 96 q22 -2 18 -22 q-3 -13 -14 -9 q9 8 1 16 q-6 5 -13 3" fill="' + fur + '" opacity=".95"/>' +
        '<path d="M112 70 q7 -4 9 3 q-3 6 -9 3 z" fill="' + pale + '"/>';
    } else if (kind === 'bunny') {
      ears = '<ellipse cx="63" cy="12" rx="8" ry="24" transform="rotate(-9 63 12)" fill="' + fur + '"' + outline + '/>' +
        '<ellipse cx="87" cy="12" rx="8" ry="24" transform="rotate(9 87 12)" fill="' + fur + '"' + outline + '/>' +
        '<ellipse cx="63" cy="13" rx="4.2" ry="16" transform="rotate(-9 63 13)" fill="' + pink + '" opacity=".9"/>' +
        '<ellipse cx="87" cy="13" rx="4.2" ry="16" transform="rotate(9 87 13)" fill="' + pink + '" opacity=".9"/>';
      extra = '<rect x="71" y="62" width="3.6" height="6" rx="1.6" fill="#fff" stroke="rgba(74,49,38,.16)"/>' +
        '<rect x="75.6" y="62" width="3.6" height="6" rx="1.6" fill="#fff" stroke="rgba(74,49,38,.16)"/>';
    } else if (kind === 'puppy') {
      ears = '<ellipse cx="53" cy="48" rx="9.5" ry="18" transform="rotate(14 53 48)" fill="' + dark + '"' + outline + '/>' +
        '<ellipse cx="97" cy="48" rx="9.5" ry="18" transform="rotate(-14 97 48)" fill="' + dark + '"' + outline + '/>';
      extra = '<ellipse cx="75" cy="66" rx="4" ry="5" fill="#F58E9C" opacity=".9"/>';
    } else if (kind === 'bear') {
      ears = '<circle cx="55" cy="24" r="11" fill="' + fur + '"' + outline + '/>' +
        '<circle cx="95" cy="24" r="11" fill="' + fur + '"' + outline + '/>' +
        '<circle cx="55" cy="24" r="6" fill="' + pink + '" opacity=".75"/>' +
        '<circle cx="95" cy="24" r="6" fill="' + pink + '" opacity=".75"/>';
    } else if (kind === 'panda') {
      headFill = '#FFFBF4';
      bodyFill = '#FFFBF4';
      ears = '<circle cx="54" cy="23" r="11" fill="#3A3A44"/>' + '<circle cx="96" cy="23" r="11" fill="#3A3A44"/>';
      extra = '<ellipse cx="65" cy="46" rx="8" ry="9" transform="rotate(-16 65 46)" fill="#3A3A44"/>' +
        '<ellipse cx="85" cy="46" rx="8" ry="9" transform="rotate(16 85 46)" fill="#3A3A44"/>';
    } else if (kind === 'chick') {
      ears = '<path d="M69 21 q2 -10 7 -3 q2 -8 7 -1" fill="none" stroke="' + deep + '" stroke-width="3" stroke-linecap="round"/>';
      headFill = fur;
    } else if (kind === 'otter') {
      ears = '<circle cx="56" cy="25" r="7" fill="' + dark + '"' + outline + '/>' +
        '<circle cx="94" cy="25" r="7" fill="' + dark + '"' + outline + '/>';
      extra = '<path d="M44 55 L30 52 M44 60 L30 62 M106 55 L120 52 M106 60 L120 62" stroke="' + deep + '" stroke-width="1.1" stroke-linecap="round" opacity=".5"/>';
    } else if (kind === 'owl') {
      ears = '<path d="M54 26 L50 8 Q50 3 57 9 L66 19 Z" fill="' + dark + '"/>' +
        '<path d="M96 26 L100 8 Q100 3 93 9 L84 19 Z" fill="' + dark + '"/>';
      extra = '<ellipse cx="75" cy="48" rx="23" ry="20" fill="' + pale + '" opacity=".9"/>' +
        '<circle cx="65" cy="46" r="8.4" fill="none" stroke="#4A3A2E" stroke-width="1.6"/>' +
        '<circle cx="85" cy="46" r="8.4" fill="none" stroke="#4A3A2E" stroke-width="1.6"/>' +
        '<path d="M73.4 46 h3.2" stroke="#4A3A2E" stroke-width="1.6"/>' +
        '<path d="M75 52 L80.5 59 L75 65 L69.5 59 Z" fill="#F0A540" stroke="#D98A2C" stroke-width=".8"/>';
    } else if (kind === 'lion') {
      ears = '<circle cx="56" cy="25" r="9" fill="' + fur + '"' + outline + '/>' +
        '<circle cx="94" cy="25" r="9" fill="' + fur + '"' + outline + '/>';
      extra = '<path d="M75 8 q8 8 16 4 q4 9 13 8 q-1 10 7 15 q-7 7 -2 16 q-10 2 -11 12 q-10 -3 -16 6 q-6 -9 -16 -6 q-1 -10 -11 -12 q5 -9 -2 -16 q8 -5 7 -15 q9 1 13 -8 q8 4 16 -4 z" fill="' + mixHex(fur, '#C98A3C', 0.55) + '" opacity=".55"/>';
    }

    const crown = kind === 'lion'
      ? '<g class="pet-crown"><path d="M60 12 L64 2 L69 9 L75 1 L81 9 L86 2 L90 12 Z" fill="#FFD873" stroke="#D9A93E" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="75" cy="8" r="1.8" fill="#E2574C"/></g>'
      : '';

    const muzzle = (kind === 'chick')
      ? '<path d="M68.5 51 L81.5 51 L75 60 Z" fill="#F4A63A" stroke="#DB8C27" stroke-width=".8" stroke-linejoin="round"/>'
      : (kind === 'owl' ? '' :
        '<ellipse cx="75" cy="57" rx="12.5" ry="9" fill="' + pale + '" opacity=".95"/>' +
        '<path d="M71.4 53.6 q3.6 -2.8 7.2 0 q-1.5 4 -3.6 4 q-2.1 0 -3.6 -4 z" fill="' + ink + '"/>');

    const mouth = (kind === 'chick' || kind === 'owl')
      ? ''
      : (opts.talk
        ? '<ellipse cx="75" cy="63.5" rx="3.4" ry="2.8" fill="#A9553F"/>'
        : '<path d="M71 61.5 q4 3.4 8 0" fill="none" stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round"/>');

    const eye = (cx) => sleep
      ? '<path d="M' + (cx - 6.5) + ' 46 q6.5 5.5 13 0" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>'
      : '<g class="pet-eye"><ellipse cx="' + cx + '" cy="45" rx="4.3" ry="5" fill="' + ink + '"/>' +
        '<circle cx="' + (cx - 1.5) + '" cy="43.2" r="1.5" fill="#fff" opacity=".95"/></g>';

    const face =
      (kind === 'panda' ? '' : '') + eye(65) + eye(85) +
      '<ellipse cx="53" cy="56" rx="6.4" ry="3.6" fill="#FF9AA6" opacity=".45"/>' +
      '<ellipse cx="97" cy="56" rx="6.4" ry="3.6" fill="#FF9AA6" opacity=".45"/>' +
      muzzle + mouth +
      (kind === 'owl' ? '' : '');

    const coffee = opts.coffee
      ? '<g class="pet-coffee"><ellipse cx="97" cy="84" rx="6" ry="2.4" fill="' + white + '"/>' +
        '<path d="M91 84 v7 a6 2.4 0 0 0 12 0 v-7" fill="' + white + '" stroke="rgba(74,49,38,.18)" stroke-width=".8"/>' +
        '<path d="M103 86 q4 1.4 0 3.4" fill="none" stroke="' + white + '" stroke-width="1.6"/>' +
        '<ellipse cx="97" cy="83.4" rx="4.6" ry="1.7" fill="#C98B5E"/></g>'
      : '';

    const arms = '<g class="pet-arms">' +
      '<ellipse class="pet-arm arm-l" cx="55" cy="80" rx="9.5" ry="11.5" fill="' + fur + '"' + outline + '/>' +
      '<ellipse class="pet-arm arm-r" cx="95" cy="80" rx="9.5" ry="11.5" fill="' + fur + '"' + outline + '/>' +
      '<circle cx="55" cy="88" r="4.2" fill="' + pale + '" opacity=".9"/>' +
      '<circle cx="95" cy="88" r="4.2" fill="' + pale + '" opacity=".9"/>' +
      '</g>' + coffee;

    return '<g class="pet pet-' + kind + (sleep ? ' sleeping' : '') + '" data-animal="' + kind + '">' +
      '<ellipse class="pet-shadow" cx="75" cy="104" rx="30" ry="6" fill="#2A1C14" opacity=".14"/>' +
      extra +
      '<rect class="pet-body" x="52" y="60" width="46" height="44" rx="21" fill="' + bodyFill + '"' + outline + '/>' +
      '<ellipse cx="75" cy="84" rx="15" ry="14" fill="' + pale + '" opacity=".92"/>' +
      arms +
      ears + crown +
      '<circle class="pet-head" cx="75" cy="46" r="26" fill="' + headFill + '"' + outline + '/>' +
      '<ellipse cx="67" cy="33" rx="13" ry="8" fill="#FFFFFF" opacity=".24"/>' +
      face +
      '</g>';
  }

  /* ── 책상 그림 (좌표계 150 x 190) ── */
  function deskSvg(p, animal, opts) {
    opts = opts || {};
    const wide = !!opts.ceo || !!opts.lead;
    const away = officeAtLounge(p);
    const x1 = wide ? 6 : 18;
    const x2 = wide ? 144 : 132;
    const mid = 75, topY = 96, midY = 122, botY = 146, th = 12;
    let s = '<g class="desk' + (wide ? ' desk-wide' : '') + '">';

    if (away) {
      s += '<g class="chair empty-chair">' +
        '<rect x="62" y="80" width="26" height="26" rx="10" fill="var(--f-fabric)"/>' +
        '<rect x="58" y="99" width="34" height="10" rx="5" fill="var(--f-fabric-2)"/>' +
        '<rect x="70" y="118" width="10" height="14" fill="var(--f-metal)"/>' +
        '<rect x="62" y="130" width="26" height="5" rx="2.5" fill="var(--f-metal)"/>' +
        '</g>';
    }

    // 바닥 그림자 · 다리
    s += '<ellipse class="desk-shadow" cx="' + mid + '" cy="' + (botY + 20) + '" rx="' + (wide ? 58 : 48) + '" ry="9" fill="rgba(76,50,26,.13)"/>';
    s += '<rect class="desk-leg" x="' + (x1 + 8) + '" y="' + (midY + th - 4) + '" width="7" height="32" rx="2"/>';
    s += '<rect class="desk-leg" x="' + (x2 - 15) + '" y="' + (midY + th - 4) + '" width="7" height="32" rx="2"/>';
    // 상판 + 앞·옆면
    s += '<polygon class="desk-top" points="' + mid + ',' + topY + ' ' + x2 + ',' + midY + ' ' + mid + ',' + botY + ' ' + x1 + ',' + midY + '"/>';
    s += '<polygon class="desk-fl" points="' + x1 + ',' + midY + ' ' + mid + ',' + botY + ' ' + mid + ',' + (botY + th) + ' ' + x1 + ',' + (midY + th) + '"/>';
    s += '<polygon class="desk-fr" points="' + mid + ',' + botY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + (midY + th) + ' ' + mid + ',' + (botY + th) + '"/>';
    s += '<polygon class="desk-shade" points="' + x1 + ',' + (midY + th) + ' ' + mid + ',' + (botY + th) + ' ' + x2 + ',' + (midY + th) + ' ' + mid + ',' + (botY + th + 3) + '"/>';
    // 상판 결
    s += '<path class="desk-grain" d="M' + (x1 + 22) + ' ' + (midY - 8) + ' L' + (mid - 14) + ' ' + (botY - 10) + ' M' + (mid + 18) + ' ' + (botY - 8) + ' L' + (x2 - 16) + ' ' + (midY - 4) + '"/>';

    // 모니터 (오른쪽) — working이면 화면이 켜져 빛난다
    const on = p.status === 'working';
    s += '<g class="monitor' + (on ? ' on' : '') + '">' +
      '<rect x="101" y="88" width="32" height="26" rx="3" fill="#39414E" stroke="#2B323D"/>' +
      '<rect class="mon-screen" x="103.5" y="90.5" width="27" height="21" rx="2" fill="' + (on ? '#BFE8FF' : '#2C3542') + '"/>' +
      (on ? '<path class="mon-line" d="M107 96 h20 M107 101 h14 M107 106 h17" stroke="#7EC8F0" stroke-width="1.6" stroke-linecap="round"/>' : '') +
      '<rect x="113" y="114" width="8" height="8" fill="#4A5461"/>' +
      '<ellipse cx="117" cy="123" rx="11" ry="3" fill="#4A5461"/>' +
      '</g>';

    // 머그컵 · 서류 · 화분
    s += '<g class="mug"><ellipse cx="41" cy="114" rx="7.5" ry="3.4" fill="var(--f-white)"/>' +
      '<path d="M33.5 114 v7 a7.5 3.4 0 0 0 15 0 v-7" fill="var(--f-white)"/>' +
      '<path d="M48 115 q4 1 0 4" fill="none" stroke="var(--f-white)" stroke-width="1.6"/></g>';
    s += '<polygon class="paper" points="48,124 64,130 56,135 40,129"/>';
    if (wide) s += '<g class="desk-plant"><ellipse cx="33" cy="104" rx="5.5" ry="5" fill="var(--f-leaf)"/>' +
      '<ellipse cx="27" cy="101" rx="4.5" ry="4" fill="var(--f-leaf-2)"/>' +
      '<rect x="27" y="103" width="11" height="8" rx="2" fill="var(--f-pot)"/></g>';

    // 명패 — 사장·팀장은 금색
    if (wide) {
      s += '<rect class="nameplate" x="60" y="150" width="30" height="7" rx="2" fill="#F5C95B" stroke="#D9A93E"/>' +
        '<text class="nameplate-tx" x="75" y="155.6" font-size="4.6" text-anchor="middle" fill="#7A5320">' + (opts.ceo ? 'CEO' : 'LEAD') + '</text>';
    }

    if (on) {
      s += '<g class="type-spark"><circle cx="46" cy="112" r="1.6"/><circle cx="60" cy="118" r="1.3"/><circle cx="52" cy="120" r="1.1"/></g>';
    }
    s += '</g>';
    return s;
  }

  /* ── 자리 배치 (등각 격자 좌표) ── */
  const OFC_SLOTS = {
    ceo: [[2.8, 2.2]],
    leads: [[12.6, 2.2], [15.4, 2.2]],
    a: [[1.3, 6.2], [4.1, 6.2], [1.3, 8.6], [4.1, 8.6], [1.3, 11.0], [4.1, 11.0]],
    b: [[12.3, 6.2], [15.0, 6.2], [12.3, 8.6], [15.0, 8.6], [12.3, 11.0], [15.0, 11.0]],
    n: [[3.2, 13.5], [4.9, 13.5], [6.6, 13.5], [8.3, 13.5], [10.0, 13.5]]
  };
  const OFC_EXTRA_SLOTS = {
    a: [[1.3, 12.5], [4.1, 12.5]],
    b: [[12.3, 12.5], [15.0, 12.5]],
    leads: [[16.4, 3.3]],
    n: [[11.7, 13.5], [2.2, 14.3], [4.4, 14.3]],
    ceo: [[5.2, 3.2]]
  };
  // 라운지 자리 — 소파 2개(각 2석) + 바닥 쿠션 6개
  const OFC_LOUNGE_SLOTS = [
    [7.15, 6.5], [8.65, 6.5], [7.15, 8.3], [8.65, 8.3],
    [7.4, 10.05], [8.9, 10.05], [10.4, 10.05], [7.4, 11.55], [8.9, 11.55], [10.4, 11.55]
  ];

  function officeSeatSlots(snap) {
    const map = new Map();
    ['ceo', 'leads', 'a', 'b', 'n'].forEach(key => {
      const arr = key === 'leads' ? snap.leads : snap.zones[key];
      const base = OFC_SLOTS[key] || [];
      const extra = OFC_EXTRA_SLOTS[key] || [];
      (arr || []).forEach((p, i) => {
        let slot = i < base.length ? base[i] : extra[(i - base.length) % (extra.length || 1)];
        if (!slot) slot = [2 + i * 0.6, 12.6];
        map.set(p.id, slot);
      });
    });
    return map;
  }

  /* ── 배경(바닥·벽·가구) SVG ── */
  function rug(x1, y1, x2, y2, cls) {
    return isoPoly([isoP(x1, y1), isoP(x2, y1), isoP(x2, y2), isoP(x1, y2)], 'rug ' + cls) +
      isoPoly([isoP(x1 + 0.16, y1 + 0.16), isoP(x2 - 0.16, y1 + 0.16), isoP(x2 - 0.16, y2 - 0.16), isoP(x1 + 0.16, y2 - 0.16)], 'rug-in');
  }

  function floorLabel(gx, gy, text, cls) {
    const p = iso(gx, gy);
    return '<text class="flabel ' + (cls || '') + '" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) +
      '" transform="rotate(26.57 ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ')" text-anchor="middle">' + text + '</text>';
  }

  function wallWinN(g1, g2, h1, h2) {
    const g1i = g1 - 0.1, g2i = g2 + 0.1;
    return '<g class="win">' +
      isoPoly([isoP(g1i, 0, h1 - 6), isoP(g2i, 0, h1 - 6), isoP(g2i, 0, h2 + 6), isoP(g1i, 0, h2 + 6)], 'win-frame') +
      isoPoly([isoP(g1, 0, h1), isoP(g2, 0, h1), isoP(g2, 0, h2), isoP(g1, 0, h2)], 'win-glass') +
      isoPoly([isoP((g1 + g2) / 2 - 0.05, 0, h1), isoP((g1 + g2) / 2 + 0.05, 0, h1), isoP((g1 + g2) / 2 + 0.05, 0, h2), isoP((g1 + g2) / 2 - 0.05, 0, h2)], 'win-bar') +
      isoPoly([isoP(g1, 0, (h1 + h2) / 2 - 3), isoP(g2, 0, (h1 + h2) / 2 - 3), isoP(g2, 0, (h1 + h2) / 2 + 1), isoP(g1, 0, (h1 + h2) / 2 + 1)], 'win-bar') +
      isoPoly([isoP(g1i - 0.06, 0, h1 - 10), isoP(g2i + 0.06, 0, h1 - 10), isoP(g2i + 0.06, 0, h1 - 6), isoP(g1i - 0.06, 0, h1 - 6)], 'win-sill') +
      '</g>';
  }

  function treePlant(x, y, k) {
    k = k || 1;
    const p = iso(x, y);
    const cx = p[0], cy = p[1];
    return '<g class="plant">' + box3d(x, y, 0.5, 0.5, 15, 'pot') +
      '<line class="stem" x1="' + cx + '" y1="' + (cy - 12) + '" x2="' + cx + '" y2="' + (cy - 44 * k) + '"/>' +
      '<ellipse cx="' + (cx - 11 * k) + '" cy="' + (cy - 38 * k) + '" rx="' + (12 * k) + '" ry="' + (9 * k) + '" fill="var(--f-leaf)"/>' +
      '<ellipse cx="' + (cx + 12 * k) + '" cy="' + (cy - 44 * k) + '" rx="' + (11 * k) + '" ry="' + (8.5 * k) + '" fill="var(--f-leaf-2)"/>' +
      '<ellipse cx="' + cx + '" cy="' + (cy - 56 * k) + '" rx="' + (9.5 * k) + '" ry="' + (8 * k) + '" fill="var(--f-leaf)"/>' +
      '</g>';
  }

  function sofa(x, y, w, d, tone) {
    let s = '<g class="sofa">';
    s += box3d(x, y, w, d, 16, tone || 'fabric');
    s += box3d(x, y, w, 0.22, 34, tone || 'fabric');
    s += box3d(x - 0.02, y + 0.16, 0.18, d - 0.16, 24, tone || 'fabric');
    s += box3d(x + w - 0.16, y + 0.16, 0.18, d - 0.16, 24, tone || 'fabric');
    s += box3d(x + 0.24, y + 0.3, (w - 0.56) / 2, d - 0.46, 21, 'fabric-light');
    s += box3d(x + 0.24 + (w - 0.56) / 2 + 0.08, y + 0.3, (w - 0.56) / 2, d - 0.46, 21, 'fabric-light');
    s += '</g>';
    return s;
  }

  function officeSceneSvg(snap) {
    const nCount = (snap && snap.zones && snap.zones.n) ? snap.zones.n.length : 0;
    let s = '<svg class="iso-scene" viewBox="0 0 ' + OFC_SCENE_W + ' ' + OFC_SCENE_H + '" aria-hidden="true">';

    // 벽 (뒤) — 북쪽 벽과 서쪽 벽
    s += '<g class="wall wall-n">' +
      isoPoly([isoP(0, 0, 0), isoP(OFC_GW, 0, 0), isoP(OFC_GW, 0, OFC_WALL_H), isoP(0, 0, OFC_WALL_H)], 'wall-face') +
      isoPoly([isoP(0, 0, 0), isoP(OFC_GW, 0, 0), isoP(OFC_GW, 0, 30), isoP(0, 0, 30)], 'wall-skirting') +
      isoPoly([isoP(0, 0, OFC_WALL_H), isoP(OFC_GW, 0, OFC_WALL_H), isoP(OFC_GW, 0, OFC_WALL_H + 9), isoP(0, 0, OFC_WALL_H + 9)], 'wall-cap') +
      '</g>';
    s += '<g class="wall wall-w">' +
      isoPoly([isoP(0, 0, 0), isoP(0, OFC_GH, 0), isoP(0, OFC_GH, OFC_WALL_H), isoP(0, 0, OFC_WALL_H)], 'wall-face-2') +
      isoPoly([isoP(0, 0, 0), isoP(0, OFC_GH, 0), isoP(0, OFC_GH, 30), isoP(0, 0, 30)], 'wall-skirting') +
      isoPoly([isoP(0, 0, OFC_WALL_H), isoP(0, OFC_GH, OFC_WALL_H), isoP(0, OFC_GH, OFC_WALL_H + 9), isoP(0, 0, OFC_WALL_H + 9)], 'wall-cap') +
      // 서쪽 벽 창문 (같은 방식으로 벽면에 그린다)
      isoPoly([isoP(0, 5.0, 100), isoP(0, 7.4, 100), isoP(0, 7.4, 190), isoP(0, 5.0, 190)], 'win-frame') +
      isoPoly([isoP(0, 5.1, 106), isoP(0, 7.3, 106), isoP(0, 7.3, 184), isoP(0, 5.1, 184)], 'win-glass') +
      isoPoly([isoP(0, 6.15, 106), isoP(0, 6.25, 106), isoP(0, 6.25, 184), isoP(0, 6.15, 184)], 'win-bar') +
      '</g>';

    // 창문·시계·화이트보드
    s += wallWinN(1.8, 4.2, 96, 188);
    s += wallWinN(9.0, 11.8, 96, 188);
    const ck = iso(6.4, 0);
    s += '<g class="wall-clock"><circle cx="' + ck[0].toFixed(1) + '" cy="' + (ck[1] - 158).toFixed(1) + '" r="24" fill="var(--f-white)" stroke="var(--f-wood-face)" stroke-width="5"/>' +
      '<path d="M' + ck[0].toFixed(1) + ' ' + (ck[1] - 158).toFixed(1) + ' v-11 M' + ck[0].toFixed(1) + ' ' + (ck[1] - 158).toFixed(1) + ' h8" stroke="#6B5A48" stroke-width="3" stroke-linecap="round"/></g>';
    // 화이트보드 (북쪽 벽, 팀장실 위)
    const wb1 = iso(12.7, 0), wb2 = iso(15.5, 0);
    s += '<g class="whiteboard">' +
      isoPoly([isoP(12.6, 0, 64), isoP(15.6, 0, 64), isoP(15.6, 0, 158), isoP(12.6, 0, 158)], 'wb-frame') +
      isoPoly([isoP(12.68, 0, 70), isoP(15.52, 0, 70), isoP(15.52, 0, 152), isoP(12.68, 0, 152)], 'wb-face') +
      '<g transform="translate(' + ((wb1[0] + wb2[0]) / 2 - 26).toFixed(1) + ',' + (((wb1[1] + wb2[1]) / 2) - 124).toFixed(1) + ') rotate(26.57)">' +
      '<text class="wb-title" x="0" y="0" font-size="24" font-weight="800">TEAM</text>' +
      '<path d="M2 8 h62" stroke="#8FB7E8" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="4" y="16" width="20" height="14" rx="2" fill="#FFE28A" opacity=".9"/>' +
      '<rect x="28" y="20" width="16" height="11" rx="2" fill="#FFC0CB" opacity=".9"/>' +
      '<rect x="48" y="16" width="14" height="13" rx="2" fill="#BFE3C0" opacity=".9"/>' +
      '</g></g>';

    // 바닥 타일
    s += '<g class="iso-floor">';
    for (let gy = 0; gy < OFC_GH; gy++) {
      for (let gx = 0; gx < OFC_GW; gx++) {
        s += isoPoly([isoP(gx, gy), isoP(gx + 1, gy), isoP(gx + 1, gy + 1), isoP(gx, gy + 1)], 'tile tile-' + ((gx + gy) % 2 ? 'b' : 'a'));
      }
    }
    for (let gy = 1; gy < OFC_GH; gy++) { const a = iso(0, gy), b = iso(OFC_GW, gy); s += '<line class="plank" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>'; }
    for (let gx = 2; gx < OFC_GW; gx += 2) { const a = iso(gx, 0), b = iso(gx, OFC_GH); s += '<line class="plank-v" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>'; }
    s += '</g>';

    // 구역 러그
    s += rug(0.35, 5.15, 6.05, 12.0, 'rug-a');
    s += rug(11.65, 5.15, 16.6, 12.0, 'rug-b');
    s += rug(6.2, 5.15, 11.45, 12.25, 'rug-lounge');
    s += rug(0.35, 0.35, 6.25, 4.15, 'rug-ceo');
    s += rug(11.55, 0.35, 16.65, 4.15, 'rug-leads');
    if (nCount) s += rug(1.6, 12.7, 10.9, 14.35, 'rug-new');

    // 구역 이름
    s += floorLabel(5.5, 1.0, 'CEO ROOM', 'fl-ceo');
    s += floorLabel(12.0, 1.0, 'LEADS', 'fl-leads');
    s += floorLabel(0.75, 12.5, 'A사단 존', 'fl-a');
    s += floorLabel(16.2, 12.4, 'B사단 존', 'fl-b');
    if (nCount) s += floorLabel(4.8, 14.1, '새로 합류', 'fl-n');
    s += floorLabel(9.5, 12.9, 'LOUNGE', 'fl-lounge');

    // 햇살 (창문 아래로 비스듬히)
    s += '<g class="beams">' +
      isoPoly([isoP(1.9, 0, 94), isoP(4.1, 0, 94), isoP(5.9, 3.2, 0), isoP(3.7, 3.2, 0)], 'beam') +
      isoPoly([isoP(9.1, 0, 94), isoP(11.7, 0, 94), isoP(13.5, 3.2, 0), isoP(10.9, 3.2, 0)], 'beam') +
      '</g>';

    // 가구 — 뒤쪽(벽)부터 앞쪽 순서로
    s += '<g class="furn">';
    s += box3d(0.55, 0.1, 1.4, 0.45, 104, 'wood2', 'bookshelf');
    // 책장 앞면의 책등 (사장실 뒤편)
    const bs = iso(1.1, 0.55);
    for (let i = 0; i < 5; i++) {
      s += '<rect class="book b' + (i % 5) + '" x="' + (bs[0] - 19 + i * 8).toFixed(1) + '" y="' + (bs[1] - 84 + (i % 2) * 3).toFixed(1) + '" width="6" height="' + (30 - (i % 3) * 5) + '" rx="1.4"/>';
    }
    s += box3d(7.0, 0.1, 0.65, 0.45, 92, 'metal', 'coffee');   // 커피머신
    s += box3d(15.9, 0.1, 0.8, 0.5, 126, 'metal', 'vending');   // 자판기
    const vg = iso(16.3, 0.6);
    s += '<rect class="vending-glass" x="' + (vg[0] - 12).toFixed(1) + '" y="' + (vg[1] - 104).toFixed(1) + '" width="23" height="58" rx="3"/>';
    for (let i = 0; i < 6; i++) {
      s += '<rect class="can c' + (i % 4) + '" x="' + (vg[0] - 9 + (i % 3) * 7).toFixed(1) + '" y="' + (vg[1] - 100 + Math.floor(i / 3) * 16).toFixed(1) + '" width="5" height="11" rx="1.6"/>';
    }
    s += '<rect class="vending-slot" x="' + (vg[0] - 9).toFixed(1) + '" y="' + (vg[1] - 40).toFixed(1) + '" width="17" height="6" rx="2" fill="#59616E"/>';
    s += treePlant(16.2, 1.2, 1.05);
    s += treePlant(0.55, 4.35, 0.9);

    // 사장실 — 안락의자 + 협탁
    s += box3d(4.85, 2.25, 0.85, 0.8, 20, 'fabric-light', 'armchair');
    s += box3d(4.85, 2.05, 0.85, 0.22, 42, 'fabric-light', 'armchair-back');
    s += box3d(4.9, 3.25, 0.6, 0.5, 18, 'wood', 'side-table');

    // 라운지 — 소파 2개 · 커피 테이블 · 쿠션
    s += sofa(6.55, 5.55, 2.65, 0.95);
    s += sofa(6.55, 7.35, 2.65, 0.95);
    s += box3d(9.55, 6.2, 1.15, 1.0, 17, 'wood', 'coffee-table');
    s += '<ellipse class="cmug" cx="' + (iso(10.0, 6.7)[0] + 3).toFixed(1) + '" cy="' + (iso(10.0, 6.7)[1] - 20).toFixed(1) + '" rx="4" ry="2" fill="var(--f-white)"/>';
    for (let i = 0; i < 6; i++) {
      const c = OFC_LOUNGE_SLOTS[4 + i];
      const q = iso(c[0], c[1]);
      s += '<ellipse class="cushion" cx="' + q[0].toFixed(1) + '" cy="' + (q[1] - 6).toFixed(1) + '" rx="21" ry="10" fill="var(--f-fabric-light)"/>';
    }
    s += treePlant(10.7, 9.2, 0.95);
    s += '<g class="floor-lamp"><line x1="' + iso(6.3, 5.0)[0] + '" y1="' + iso(6.3, 5.0)[1] + '" x2="' + iso(6.3, 5.0)[0] + '" y2="' + (iso(6.3, 5.0)[1] - 96) + '" stroke="var(--f-metal)" stroke-width="3"/>' +
      '<path d="M' + (iso(6.3, 5.0)[0] - 16) + ' ' + (iso(6.3, 5.0)[1] - 96) + ' h32 l-7 -18 h-18 z" fill="var(--f-lamp)"/></g>';

    // 탕비실 — 카운터 · 커피포트 · 스툴
    s += box3d(8.3, 0.1, 2.1, 0.55, 44, 'wood', 'pantry');
    s += box3d(8.5, 0.15, 0.45, 0.4, 62, 'metal', 'kettle');
    s += box3d(9.9, 0.2, 0.4, 0.35, 54, 'metal', 'kettle2');
    s += '<ellipse class="cup" cx="' + (iso(9.3, 0.45)[0]).toFixed(1) + '" cy="' + (iso(9.3, 0.45)[1] - 48).toFixed(1) + '" rx="4" ry="2" fill="var(--f-white)"/>';
    s += treePlant(10.7, 0.5, 0.75);

    // 회의 테이블 (B사단 존 앞 빈 자리)
    const mt = iso(13.9, 13.0);
    s += '<ellipse class="meet-shadow" cx="' + mt[0].toFixed(1) + '" cy="' + (mt[1] + 6).toFixed(1) + '" rx="52" ry="16" fill="rgba(76,50,26,.12)"/>';
    s += '<ellipse class="meet-top" cx="' + mt[0].toFixed(1) + '" cy="' + (mt[1] - 16).toFixed(1) + '" rx="46" ry="20" fill="var(--f-wood-top)" stroke="rgba(110,78,46,.2)"/>';
    s += '<ellipse class="meet-edge" cx="' + mt[0].toFixed(1) + '" cy="' + (mt[1] - 10).toFixed(1) + '" rx="46" ry="20" fill="var(--f-wood-face)"/>';
    s += '<ellipse class="meet-top" cx="' + mt[0].toFixed(1) + '" cy="' + (mt[1] - 16).toFixed(1) + '" rx="46" ry="20" fill="var(--f-wood-top)"/>';
    s += '<rect class="meet-leg" x="' + (mt[0] - 5).toFixed(1) + '" y="' + (mt[1] - 12).toFixed(1) + '" width="10" height="24" rx="3" fill="var(--f-wood-side)"/>';
    s += '<ellipse class="meet-paper" cx="' + (mt[0] - 12).toFixed(1) + '" cy="' + (mt[1] - 20).toFixed(1) + '" rx="11" ry="5" fill="var(--f-white)"/>';
    s += '<circle class="meet-cup" cx="' + (mt[0] + 14).toFixed(1) + '" cy="' + (mt[1] - 18).toFixed(1) + '" r="4" fill="var(--f-white)"/>';
    s += treePlant(16.2, 13.4, 0.85);

    // 화분 몇 개
    s += treePlant(6.0, 12.0, 0.85);
    s += treePlant(11.9, 12.2, 0.85);
    s += treePlant(16.3, 12.6, 0.9);
    s += treePlant(8.9, 12.9, 0.8);
    s += '</g>';

    // 파티션 (사장실·팀장실 유리벽)
    s += '<g class="partitions">';
    s += box3d(0.4, 4.25, 3.2, 0.08, 84, 'glass');
    s += box3d(6.0, 0.4, 0.08, 3.7, 84, 'glass');
    s += box3d(11.6, 4.25, 4.2, 0.08, 84, 'glass');
    s += box3d(11.5, 0.4, 0.08, 3.7, 84, 'glass');
    s += '</g>';

    // 벚꽃 잎 · 별 (테마별로 CSS가 켜고 끈다)
    s += '<g class="deco deco-petals">';
    for (let i = 0; i < 44; i++) {
      const gx = 0.6 + ((i * 2.7) % 15.4), gy = 0.7 + ((i * 3.1) % 13.2);
      const q = iso(gx, gy);
      const cy = q[1] - 26 - (i % 7) * 22;
      s += '<ellipse class="petal p' + (i % 6) + '" cx="' + q[0].toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="8.5" ry="5.2" transform="rotate(' + (i * 37) + ' ' + q[0].toFixed(1) + ' ' + cy.toFixed(1) + ')" style="animation-delay:' + ((i % 7) * 0.9).toFixed(1) + 's"/>';
    }
    // 바닥에 쌓인 꽃잎
    for (let i = 0; i < 10; i++) {
      const q = iso(1.2 + ((i * 3.3) % 14), 2.0 + ((i * 2.1) % 11));
      s += '<ellipse class="petal floor p' + (i % 6) + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" rx="6" ry="3.4" transform="rotate(' + (i * 23) + ' ' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ')"/>';
    }
    s += '</g>';
    s += '<g class="deco deco-stars">';
    for (let i = 0; i < 12; i++) {
      const q = iso(2.2 + (i % 6) * 0.36, 0);
      s += '<circle class="star s' + (i % 3) + '" cx="' + (q[0] + (i % 3) * 14).toFixed(1) + '" cy="' + (q[1] - 120 - (i % 4) * 16).toFixed(1) + '" r="' + (1.6 + (i % 2)) + '"/>';
    }
    s += '</g>';
    s += '</svg>';
    return s;
  }

  /* ── 상태별 말풍선 문구 ── */
  function officeBubble(p) {
    const list = ['열일중!', '작성 중...', '타닥타닥', '집중!', '보고 쓰는 중'];
    return list[officeHash(p.id) % list.length];
  }

  /* ── 좌석(책상) 요소 ── */
  function officeSeatEl(p, opts) {
    opts = opts || {};
    const animal = officeAnimal(p);
    const away = officeAtLounge(p);
    const bench = !!opts.bench;
    const b = el('button', 'seat st-' + p.status + ' animal-' + animal.kind +
      (opts.ceo ? ' ceo' : '') + (opts.lead ? ' lead' : '') + (p.dyn ? ' dyn' : '') +
      (away ? ' away' : '') + (bench ? ' bench' : ''));
    b.type = 'button';
    b.dataset.mid = p.id;
    b.dataset.status = p.status;
    b.dataset.animal = animal.kind;
    b.title = p.name + ' · ' + p.role + ' · ' + officeBadge(p, p.status);
    const slot = opts.slot || [0, 0];
    const pos = iso(slot[0], slot[1]);
    b.dataset.gx = String(slot[0]);
    b.dataset.gy = String(slot[1]);
    b.style.left = pos[0].toFixed(1) + 'px';
    b.style.top = (pos[1] + (bench ? 6 : 16)).toFixed(1) + 'px';
    b.style.zIndex = String(120 + Math.round((slot[0] + slot[1]) * 8));

    const badge = el('span', 'seat-badge', officeBadge(p, p.status));
    if (p.status !== 'working' && p.id !== 'ceo') badge.classList.add('mini');
    b.appendChild(badge);

    const stage = el('span', 'seat-stage');
    if (bench) {
      stage.innerHTML = '<svg class="seat-art bench-art" viewBox="36 0 78 112" aria-hidden="true">' +
        petSvg(animal.kind, animal.fur, { sleep: p.status === 'idle', talk: p.status === 'working' }) +
        '</svg>';
    } else {
      stage.innerHTML = '<svg class="seat-art" viewBox="0 0 150 190" aria-hidden="true">' +
        (away ? '' : petSvg(animal.kind, animal.fur, { sleep: p.status === 'idle' && p.id !== 'ceo', talk: p.status === 'working', coffee: p.status === 'waiting' })) +
        deskSvg(p, animal, opts) +
        '</svg>';
    }
    if (!bench && away) stage.appendChild(el('span', 'seat-empty-tag', '자리 비움'));
    else if (!away && p.status === 'working') stage.appendChild(el('span', 'pet-bubble bubble-work', officeBubble(p)));
    else if (!away && p.status === 'active') stage.appendChild(el('span', 'pet-bubble bubble-active', '작성 중…'));

    b.appendChild(stage);

    const plate = el('span', 'seat-plate st-' + p.status);
    plate.appendChild(el('em', 'seat-dot'));
    plate.appendChild(el('b', '', p.name));
    plate.appendChild(el('i', '', bench ? '새로 합류' : (animal.label || '')));
    b.appendChild(plate);

    b.addEventListener('click', () => openSeatSheet(p));
    return b;
  }

  /* ── 라운지에서 쉬는 대원 ── */
  function officeLoungeEl(snap) {
    const wrap = el('div', 'ofc-lounge');
    const sleepers = snap.all.filter(officeAtLounge);
    sleepers.forEach((p, i) => {
      const animal = officeAnimal(p);
      const slot = OFC_LOUNGE_SLOTS[i % OFC_LOUNGE_SLOTS.length];
      const pos = iso(slot[0], slot[1]);
      const n = el('button', 'lounge-pet st-idle');
      n.type = 'button';
      n.dataset.mid = p.id;
      n.dataset.animal = animal.kind;
      n.dataset.gx = String(slot[0]);
      n.dataset.gy = String(slot[1]);
      n.title = p.name + ' · 💤 휴식 중 (라운지)';
      n.style.left = pos[0].toFixed(1) + 'px';
      n.style.top = (pos[1] + 4).toFixed(1) + 'px';
      n.style.zIndex = String(118 + Math.round((slot[0] + slot[1]) * 8));
      n.innerHTML = '<svg class="lounge-art" viewBox="36 0 78 116" aria-hidden="true">' +
        petSvg(animal.kind, animal.fur, { sleep: true }) + '</svg>' +
        '<span class="zzz"><i>Z</i><i>z</i><i>z</i></span>' +
        '<span class="lounge-name">' + p.name + '</span>';
      n.addEventListener('click', () => openSeatSheet(p));
      wrap.appendChild(n);
    });
    return wrap;
  }

  /* ── 오피스 지도 전체 ── */
  const ofcView = { scale: 1, fit: 1, x: 0, y: 0, touched: false };

  function officeApplyTransform(world) {
    if (!world) return;
    world.style.transform = 'translate(' + ofcView.x.toFixed(1) + 'px,' + ofcView.y.toFixed(1) + 'px) scale(' + ofcView.scale.toFixed(4) + ')';
    world.dataset.scale = ofcView.scale.toFixed(3);
    const pct = document.querySelector('#office .ofc-zoom-pct');
    if (pct) pct.textContent = Math.round(ofcView.scale / (ofcView.fit || 1) * 100) + '%';
  }

  function fitOfficeView(vp) {
    if (!vp) return;
    const vw = vp.clientWidth || 0, vh = vp.clientHeight || 0;
    const fit = (vw > 80 && vh > 80) ? Math.min(vw / OFC_SCENE_W, vh / OFC_SCENE_H) : 1;
    // 처음에는 전체 보기보다 살짝 당겨(1.18배) 캐릭터가 읽히게 시작한다.
    // '↺ 100%'를 누르면 전체 보기(fit)로 돌아간다.
    let s = Math.min(0.95, fit * 1.1);
    if (s > fit * 1.2) s = fit * 1.2;
    if (s < fit) s = fit;
    ofcView.fit = fit;
    ofcView.scale = s;
    // 장면 상자(빈 모서리 포함)가 아니라 방 바닥의 중심을 화면 가운데에 둔다
    ofcView.x = vw / 2 - 532 * s;
    ofcView.y = (vh - OFC_SCENE_H * s) * 0.42;
    ofcView.touched = false;
    officeApplyTransform(document.querySelector('#office .iso-world'));
  }

  function setOfficeZoom(next, cx, cy) {
    const vp = document.querySelector('#office .ofc-viewport');
    const world = document.querySelector('#office .iso-world');
    if (!vp || !world) return;
    const lo = (ofcView.fit || 1) * 0.65, hi = (ofcView.fit || 1) * 3.2;
    const prev = ofcView.scale;
    const s = Math.max(lo, Math.min(hi, next));
    const px = (typeof cx === 'number') ? cx : (vp.clientWidth || 0) / 2;
    const py = (typeof cy === 'number') ? cy : (vp.clientHeight || 0) / 2;
    ofcView.x = px - (px - ofcView.x) * (s / prev);
    ofcView.y = py - (py - ofcView.y) * (s / prev);
    ofcView.scale = s;
    ofcView.touched = true;
    officeApplyTransform(world);
  }

  function officeTools() {
    const tools = el('div', 'ofc-tools');
    const skins = el('div', 'ofc-skins');
    OFC_SKINS.forEach(sk => {
      const b = el('button', 'ofc-skin' + (sk.id === state.skin ? ' active' : ''), sk.icon + ' ' + sk.name);
      b.type = 'button';
      b.dataset.skin = sk.id;
      b.addEventListener('click', () => {
        state.skin = sk.id;
        try { localStorage.setItem(OFC_SKIN_KEY, sk.id); } catch (e) { /* 저장 차단 환경 */ }
        const box = $('#office');
        if (box) box.dataset.skin = sk.id;
        document.querySelectorAll('#office .ofc-skin').forEach(x => x.classList.toggle('active', x.dataset.skin === sk.id));
      });
      skins.appendChild(b);
    });
    tools.appendChild(skins);
    return tools;
  }

  function officeZoomBox() {
    const box = el('div', 'ofc-zoombox');
    const mk = (cls, text, title, fn) => {
      const b = el('button', 'ofc-zbtn ' + cls, text);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    box.appendChild(mk('ofc-zoom-out', '−', '축소', () => setOfficeZoom(ofcView.scale / 1.22)));
    box.appendChild(el('span', 'ofc-zoom-pct', '100%'));
    box.appendChild(mk('ofc-zoom-in', '+', '확대', () => setOfficeZoom(ofcView.scale * 1.22)));
    box.appendChild(mk('ofc-zoom-reset', '↺ 100%', '전체 보기로 돌아가기', () => fitOfficeView(document.querySelector('#office .ofc-viewport'))));
    return box;
  }

  function officeLegend() {
    const l = el('div', 'ofc-legend');
    const item = (cls, text) => { const s = el('span', 'ofc-lg ' + cls); s.appendChild(el('i', '')); s.appendChild(el('b', '', text)); return s; };
    l.appendChild(item('working', '열일중'));
    l.appendChild(item('active', '작업함'));
    l.appendChild(item('waiting', '대기'));
    l.appendChild(item('idle', '휴식'));
    return l;
  }

  function bindOfficeMap(vp, world) {
    let drag = null;
    const pts = new Map();
    vp.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.closest && e.target.closest('.seat,.lounge-pet')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), dist0: ofcView.scale, pan: false };
        return;
      }
      drag = { x: e.clientX, y: e.clientY, ox: ofcView.x, oy: ofcView.y, pan: true, moved: false };
      vp.classList.add('grabbing');
      if (vp.setPointerCapture) { try { vp.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
    });
    vp.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        ofcView.touched = true;
        setOfficeZoom(drag.dist0 * (d / drag.pinch));
        return;
      }
      if (!drag.pan) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      ofcView.x = drag.ox + dx;
      ofcView.y = drag.oy + dy;
      ofcView.touched = true;
      officeApplyTransform(world);
    });
    const end = (e) => {
      if (e && pts.has(e.pointerId)) pts.delete(e.pointerId);
      if (pts.size < 2) drag = drag && drag.pinch ? null : drag;
      if (!e || pts.size === 0) { drag = null; vp.classList.remove('grabbing'); }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('pointerleave', (e) => { if (e.buttons === 0) end(e); });
    vp.addEventListener('wheel', (e) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      setOfficeZoom(ofcView.scale * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  function officeWrap(snap) {
    const wrap = el('div', 'ofc-wrap');
    const mapwrap = el('div', 'ofc-mapwrap');
    const vp = el('div', 'ofc-viewport');
    vp.setAttribute('aria-label', '사단 오피스 아이소메트릭 지도');
    const world = el('div', 'iso-world');
    world.style.width = OFC_SCENE_W + 'px';
    world.style.height = OFC_SCENE_H + 'px';
    world.dataset.scale = ofcView.scale.toFixed(3);
    world.innerHTML = officeSceneSvg(snap);

    const slots = officeSeatSlots(snap);
    const mkZone = (key, list) => {
      const z = el('div', 'ofc-zone z-' + key);
      (list || []).forEach(p => z.appendChild(officeSeatEl(p, {
        slot: slots.get(p.id),
        ceo: p.id === 'ceo',
        lead: !!p.lead,
        bench: key === 'n'
      })));
      return z;
    };
    world.appendChild(mkZone('ceo', snap.zones.ceo));
    const leads = el('div', 'ofc-leads');
    snap.leads.forEach(p => leads.appendChild(officeSeatEl(p, { slot: slots.get(p.id), lead: true })));
    world.appendChild(leads);
    world.appendChild(mkZone('a', snap.zones.a));
    world.appendChild(mkZone('b', snap.zones.b));
    world.appendChild(mkZone('n', snap.zones.n));
    world.appendChild(officeLoungeEl(snap));

    vp.appendChild(world);
    mapwrap.appendChild(vp);
    mapwrap.appendChild(officeTools());
    const hint = el('div', 'ofc-hint', '드래그로 이동 · 휠/핀치로 확대');
    mapwrap.appendChild(hint);
    mapwrap.appendChild(officeZoomBox());
    mapwrap.appendChild(officeLegend());
    wrap.appendChild(mapwrap);
    wrap.appendChild(officePanel(snap));

    officeApplyTransform(world);
    bindOfficeMap(vp, world);
    requestAnimationFrame(() => {
      if (!ofcView.touched) fitOfficeView(vp);
    });
    return wrap;
  }

  /* ── 오늘의 오피스 패널 ── */
  function officePanel(snap) {
    const panel = el('aside', 'ofc-panel');
    const head = el('div', 'pn-head');
    const t = el('div', 'pn-title');
    t.appendChild(el('b', '', '📋 오늘의 오피스'));
    const d = new Date();
    t.appendChild(el('span', '', (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DAY_KO[d.getDay()] + ')'));
    head.appendChild(t);
    head.appendChild(el('span', 'pn-live', 'LIVE'));
    panel.appendChild(head);

    const stats = el('div', 'pn-stats');
    const stat = (cls, n, label) => {
      const s = el('div', 'pn-stat ' + cls);
      s.appendChild(el('b', 'pn-num', String(n)));
      s.appendChild(el('i', '', label));
      return s;
    };
    stats.appendChild(stat('total', snap.counts.total, '전체'));
    stats.appendChild(stat('working', snap.counts.working, '🔥 열일'));
    stats.appendChild(stat('active', snap.counts.active, '💻 활동'));
    stats.appendChild(stat('waiting', snap.counts.waiting, '☕ 대기'));
    stats.appendChild(stat('idle', snap.counts.idle, '💤 휴식'));
    panel.appendChild(stats);

    const groups = [
      ['ceo', '👑 사장실', snap.zones.ceo],
      ['leads', '🎭 팀장실', snap.leads],
      ['a', '🌱 A사단 존', snap.zones.a],
      ['b', '🌿 B사단 존', snap.zones.b],
      ['n', '✨ 새로 합류', snap.zones.n]
    ];
    const list = el('div', 'pn-list');
    groups.forEach(gp => {
      const label = gp[1], arr = gp[2];
      if (!arr || !arr.length) return;
      const g = el('div', 'pn-group');
      const gh = el('div', 'pn-group-h');
      gh.appendChild(el('b', '', label));
      gh.appendChild(el('span', '', arr.length + '명'));
      g.appendChild(gh);
      arr.forEach(p => {
        const b = el('button', 'pn-member');
        b.type = 'button';
        b.dataset.mid = p.id;
        b.appendChild(el('span', 'pn-dot st-' + p.status));
        b.appendChild(el('span', 'pn-name', p.name));
        b.appendChild(el('span', 'pn-state', officeBadge(p, p.status)));
        b.addEventListener('click', () => focusOfficeMember(p));
        g.appendChild(b);
      });
      list.appendChild(g);
    });
    panel.appendChild(list);

    const feed = el('div', 'pn-feed');
    const fh = el('div', 'pn-group-h');
    fh.appendChild(el('b', '', '🗞 최근 시트 활동'));
    feed.appendChild(fh);
    const latest = snap.all.filter(x => x.last).sort((a, b) => b.last.ts - a.last.ts).slice(0, 6);
    if (!latest.length) feed.appendChild(el('p', 'pn-empty', '아직 올라온 기록이 없습니다.'));
    latest.forEach(x => {
      const r = el('button', 'pn-rec');
      r.type = 'button';
      const top = el('div', 'pn-rec-top');
      top.appendChild(el('b', '', x.name));
      top.appendChild(el('i', '', officeAgo(x.last.ts)));
      r.appendChild(top);
      const text = String(x.last.title || x.last.body || '(제목 없음)').replace(/\s+/g, ' ');
      r.appendChild(el('p', '', text.slice(0, 54) + (text.length > 54 ? '…' : '')));
      r.appendChild(el('span', 'pn-rec-meta', SHEETS[x.last.sheet].short + ' · ' + x.last.tab));
      r.addEventListener('click', () => focusOfficeMember(x));
      feed.appendChild(r);
    });
    panel.appendChild(feed);
    if (!officeMsgs().length) panel.appendChild(el('p', 'pn-loading', '시트를 불러오는 중…'));
    panel.appendChild(el('p', 'pn-foot', '시트 기록으로 근무 상태를 계산해요 · 30분 안 🔥 / 2시간 안 💻 / 그 밖 ☕ / 기록 없음 💤'));
    return panel;
  }

  // 패널에서 대원을 누르면 그 자리로 화면을 옮기고 반짝인 뒤 상세 시트를 연다.
  function focusOfficeMember(p) {
    const seat = document.querySelector('#office .seat[data-mid="' + p.id + '"]');
    const vp = document.querySelector('#office .ofc-viewport');
    if (seat) {
      document.querySelectorAll('#office .seat.hl, #office .lounge-pet.hl').forEach(n => n.classList.remove('hl'));
      seat.classList.add('hl');
      if (vp && seat.dataset.gx != null) {
        const pos = iso(Number(seat.dataset.gx), Number(seat.dataset.gy));
        if (vp.clientWidth > 80) {
          ofcView.x = vp.clientWidth / 2 - pos[0] * ofcView.scale;
          ofcView.y = vp.clientHeight * 0.55 - (pos[1] - 40) * ofcView.scale;
          ofcView.touched = true;
          officeApplyTransform(document.querySelector('#office .iso-world'));
        }
      }
      setTimeout(() => seat.classList.remove('hl'), 2600);
    }
    openSeatSheet(p);
  }

  /* ═════════ 🔀 사단 워크플로우 ═════════
     A·B사단 시트 기록에서 "누가(봇) · 어디로(게시 흐름) · 어디에(채널)"를 뽑아
     캔버스에 그리고, 노드를 고르면 오른쪽 '속성 · 게시 내역' 패널에 그 내역을 펼친다.
     한 행에 여러 플랫폼 링크가 있으면 그 채널들로 모두 나눠 잇는다. */
  const WF_HUBS = [
    { id: 'blog', name: '블로그·카페·SNS', short: '블로그·SNS', emoji: '📝', color: '#3B82F6' },
    { id: 'asset', name: '디지털 에셋·굿즈', short: '에셋·굿즈', emoji: '🛒', color: '#8B5CF6' },
    { id: 'store', name: '스토어·제휴', short: '스토어·제휴', emoji: '🛍️', color: '#10B981' },
    { id: 'campaign', name: '체험단·공모전', short: '체험단·공모전', emoji: '🎯', color: '#F59E0B' }
  ];
  const WF_CHANNELS = [
    { id: 'naver', name: '네이버 블로그', emoji: '🟢', hub: 'blog', color: '#03C75A',
      hosts: ['blog.naver.com'], keys: ['네이버 블로그', '네이버블로그', 'blog.naver', '실속템', '투데이리빙'] },
    { id: 'tistory', name: '티스토리', emoji: '📔', hub: 'blog', color: '#F16541',
      hosts: ['tistory.com'], keys: ['티스토리', 'tistory', 'everythingtopic'] },
    { id: 'daangn', name: '당근 카페', emoji: '🥕', hub: 'blog', color: '#FF6F0F',
      hosts: ['cafe.daangn.com', 'daangn.com'], keys: ['당근 카페', '당근카페', '당근'] },
    { id: 'pinterest', name: '핀터레스트', emoji: '📌', hub: 'blog', color: '#E60023',
      hosts: ['pinterest.'], keys: ['핀터레스트', '핀터', 'pinterest'] },
    { id: 'instagram', name: '인스타그램', emoji: '📸', hub: 'blog', color: '#E1306C',
      hosts: ['instagram.com', 'instagr.am'], keys: ['인스타그램', '인스타', '릴스'] },
    { id: 'youtube', name: '유튜브·숏폼', emoji: '🎬', hub: 'blog', color: '#FF0033',
      hosts: ['youtube.com', 'youtu.be'], keys: ['유튜브', 'youtube', '숏폼', '쇼츠'] },
    { id: 'gumroad', name: 'Gumroad', emoji: '🛍', hub: 'asset', color: '#FF90E8',
      hosts: ['gumroad.com'], keys: ['gumroad', '검로드'] },
    { id: 'kofi', name: 'Ko-fi', emoji: '☕', hub: 'asset', color: '#FF5E5B',
      hosts: ['ko-fi.com'], keys: ['ko-fi', 'kofi'] },
    { id: 'payhip', name: 'Payhip', emoji: '💳', hub: 'asset', color: '#22A06B',
      hosts: ['payhip.com'], keys: ['payhip', '페이힙'] },
    { id: 'itchio', name: 'itch.io', emoji: '🎮', hub: 'asset', color: '#FA5C5C',
      hosts: ['itch.io'], keys: ['itch.io', 'itchio'] },
    { id: 'marpple', name: '마플샵', emoji: '👕', hub: 'asset', color: '#5B4BD6',
      hosts: ['marpple.com', 'marpple.shop'], keys: ['마플샵', '마플', 'marpple'] },
    { id: 'tooldi', name: '툴디', emoji: '🧰', hub: 'asset', color: '#0EA5E9',
      hosts: ['tooldi.co.kr', 'tooldi.com'], keys: ['툴디', 'tooldi'] },
    { id: 'littly', name: '리틀리', emoji: '🔗', hub: 'store', color: '#3B82F6',
      hosts: ['litt.ly'], keys: ['리틀리', 'litt.ly', 'littly'] },
    { id: 'smartstore', name: '스마트스토어', emoji: '🏬', hub: 'store', color: '#12B76A',
      hosts: ['smartstore.naver.com'], keys: ['스마트스토어', '스피드고', 'smartstore'] },
    { id: 'review', name: '체험단 플랫폼', emoji: '🎯', hub: 'campaign', color: '#F59E0B',
      hosts: ['reviewnote.co.kr', 'revu.co.kr', 'reviews.kr', 'reviewplace.co.kr', '11st.co.kr', '29cm.co.kr'],
      keys: ['레뷰', '리뷰노트', '리뷰플레이스', '체험단', '29cm', '11번가'] }
  ];
  const WF_HUB_BY_ID = {};
  WF_HUBS.forEach(h => { WF_HUB_BY_ID[h.id] = h; });
  const WF_CHAN_BY_ID = {};
  WF_CHANNELS.forEach(c => { WF_CHAN_BY_ID[c.id] = c; });

  const WF_KIND_LABEL = { bot: 'BOT', hub: 'FLOW', chan: 'CHANNEL' };
  // 제목에 이런 '올린 일' 동사가 있어야 게시·출고로 센다.
  const WF_PUB = /발행|출고|업로드|등록|제출|공개|게시|포스팅|당첨|신청|심사|배포/;
  // 지시·의뢰·알림 행은 '올린 일'이 아니다.
  const WF_NOT_POST = /^\[(지시|공통\s*지시|긴급|라운|요청|공지|전달|Muse\s*전달|피클-B\s*요청|검수\s*요청|회신|답변|점검|알림|보고\s*요청)/;

  // 캔버스 좌표 — 화면 폭과 무관한 고정 크기 세계를 그려 두고, 화면은 팬·줌으로 본다.
  const WF_G = {
    padX: 26, padY: 26, top: 60,
    botW: 204, botH: 58, botGap: 10, groupHead: 26, groupGap: 26,
    subGap: 16,
    hubW: 190, hubH: 90,
    chanW: 226, chanH: 46, chanGap: 9, hubSep: 34,
    colGap: 88
  };
  const WF_ZOOM_MIN = 0.25, WF_ZOOM_MAX = 2;

  let wfHoverSel = null;

  function wfSelRef(sel) {
    if (!sel) return null;
    const i = String(sel).indexOf(':');
    if (i < 0) return null;
    return { kind: sel.slice(0, i), id: sel.slice(i + 1) };
  }

  function wfUrls(text) {
    return String(text || '').match(/https?:\/\/[^\s)\]"'<>]+/g) || [];
  }

  // 제목·본문에서 '올린 곳'을 모두 찾는다.
  //  · 링크 주소는 어느 플랫폼인지 가장 확실하다(제목 + 본문).
  //  · 링크가 없는 행은 제목에 적힌 이름으로 찾는다(본문까지 훑으면 다른 플랫폼 이름이 섞인다).
  function wfChannelsOf(title, body) {
    const t = String(title || '');
    const low = t.toLowerCase();
    const out = [];
    const seen = new Set();
    const add = (c, url) => {
      if (!c || seen.has(c.id)) return;
      seen.add(c.id);
      out.push({ ch: c, url: url || '' });
    };
    wfUrls(t + '\n' + String(body || '')).forEach(u => {
      const ul = u.toLowerCase();
      const c = WF_CHANNELS.find(x => x.hosts.some(h => ul.indexOf(h) >= 0));
      if (c) add(c, u);
    });
    WF_CHANNELS.forEach(c => {
      if (seen.has(c.id)) return;
      if (c.keys.some(k => low.indexOf(String(k).toLowerCase()) >= 0)) add(c, '');
    });
    return out;
  }

  // 작성자 → 워크플로우 봇(오피스 명단과 같은 규칙으로 묶는다. Pickle → 피클).
  function wfBotOf(m) {
    const r = officeResolve(m.author, m.sheet);
    if (!r) return null;
    if (typeof r === 'string') {
      if (r === 'ceo') return null;
      const f = OFFICE_FIXED.find(x => x.id === r);
      if (!f) return null;
      return { id: f.id, name: f.name, emoji: f.emoji, color: f.color, zone: f.zone, lead: !!f.lead };
    }
    return { id: r.id, name: r.name, emoji: r.emoji, color: r.color, zone: r.zone, lead: false };
  }

  // 앞머리 꼬리표는 여러 개가 겹친다: '[이관] [완료] 티스토리 79호 발행'
  const WF_MARK = /^\[([^\]]{1,26})\]\s*/;
  const WF_MARK_WORDS = /완료|출고|이관|피클|서포트|전달|보고|검수|지시|공지|요청|부분|심사|발행|업로드|등록|제출|마감/;
  function wfTitleOf(m) {
    let t = String(m.title || '').replace(/\s+/g, ' ').trim();
    for (let g = 0; g < 4; g++) {
      const mm = t.match(WF_MARK);
      if (!mm || !WF_MARK_WORDS.test(mm[1])) break;
      t = t.slice(mm[0].length);
    }
    if (!t) t = String(m.body || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/^[—\-–·:]\s*/, '').trim();
    if (t.length > 56) t = t.slice(0, 56) + '…';
    return t || '(제목 없음)';
  }

  // 시트 메시지 → { 봇, 채널, 제목, 링크, 시각 } 게시 기록 (한 행이 여러 채널이면 여러 건)
  function wfParse(msgs) {
    const out = [];
    (msgs || []).forEach(m => {
      if (!m || m.type === 'instruction') return;
      const raw = String(m.title || '').replace(/\s+/g, ' ').trim();
      if (!raw || WF_NOT_POST.test(raw)) return;
      if (!WF_PUB.test(raw)) return;
      const chans = wfChannelsOf(raw, m.body);
      if (!chans.length) return;
      const bot = wfBotOf(m);
      if (!bot) return;
      const title = wfTitleOf(m);
      chans.forEach(pair => {
        out.push({
          key: m.key + '|' + pair.ch.id,
          botId: bot.id, botName: bot.name, botEmoji: bot.emoji, botColor: bot.color, zone: bot.zone, lead: bot.lead,
          channelId: pair.ch.id, channelName: pair.ch.name, hubId: pair.ch.hub,
          url: pair.url || wfUrls(m.body)[0] || '',
          title, ts: m.ts || 0, sheet: m.sheet, tab: m.tab, row: m.row || 0,
          multi: chans.length
        });
      });
    });
    out.sort((a, b) => (b.ts - a.ts) || (b.row - a.row));
    // A시트에 적힌 보고가 B시트로 '[이관]'되어 같은 일이 두 번 잡힌다.
    // 같은 봇 · 같은 채널 · 같은 제목(앞부분)이면 하루 반 안의 것은 한 건으로 본다.
    const seen = new Set();
    return out.filter(p => {
      const sig = p.botId + '|' + p.channelId + '|' + p.title.slice(0, 24);
      const hit = seen.has(sig + '|' + Math.floor(p.ts / 36e5 / 36));
      seen.add(sig + '|' + Math.floor(p.ts / 36e5 / 36));
      return !hit;
    });
  }

  function wfFilter(posts) {
    const f = state.wf;
    let out = posts;
    if (f.period === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const s = d.getTime();
      out = out.filter(p => p.ts >= s);
    } else if (f.period === '24h') {
      const s = Date.now() - 864e5;
      out = out.filter(p => p.ts >= s);
    }
    const q = String(f.q || '').trim().toLowerCase();
    if (q) {
      out = out.filter(p => (p.title + ' ' + p.botName + ' ' + p.channelName + ' ' + p.tab).toLowerCase().indexOf(q) >= 0);
    }
    return out;
  }

  function wfModel(posts) {
    const bots = [];
    const botById = new Map();
    const mkBot = meta => {
      const b = {
        id: meta.id, name: meta.name, emoji: meta.emoji, color: meta.color, zone: meta.zone,
        lead: !!meta.lead, count: 0, last: 0, chans: new Map()
      };
      bots.push(b); botById.set(b.id, b); return b;
    };
    OFFICE_FIXED.forEach(m => { if (m.id !== 'ceo') mkBot(m); });

    const chans = [];
    const chanById = new Map();
    WF_CHANNELS.forEach(c => {
      const o = { id: c.id, name: c.name, emoji: c.emoji, hub: c.hub, color: c.color, count: 0, last: 0, bots: new Map() };
      chans.push(o); chanById.set(o.id, o);
    });
    const hubs = [];
    const hubById = new Map();
    WF_HUBS.forEach(h => {
      const o = { id: h.id, name: h.name, short: h.short || h.name, emoji: h.emoji, color: h.color, count: 0, bots: new Map(), chans: new Set() };
      hubs.push(o); hubById.set(o.id, o);
    });

    posts.forEach(p => {
      let b = botById.get(p.botId);
      if (!b) b = mkBot({ id: p.botId, name: p.botName, emoji: p.botEmoji, color: p.botColor, zone: p.zone, lead: p.lead });
      b.count++;
      if (p.ts > b.last) b.last = p.ts;
      b.chans.set(p.channelId, (b.chans.get(p.channelId) || 0) + 1);

      const c = chanById.get(p.channelId);
      if (c) {
        c.count++;
        if (p.ts > c.last) c.last = p.ts;
        c.bots.set(p.botId, (c.bots.get(p.botId) || 0) + 1);
      }
      const h = hubById.get(p.hubId);
      if (h) {
        h.count++;
        h.bots.set(p.botId, (h.bots.get(p.botId) || 0) + 1);
        h.chans.add(p.channelId);
      }
    });

    const groups = [
      { key: 'a', label: '🎭 A사단', bots: bots.filter(b => b.zone === 'a') },
      { key: 'b', label: '🌿 B사단', bots: bots.filter(b => b.zone === 'b') },
      { key: 'n', label: '✨ 새로 합류', bots: bots.filter(b => b.zone !== 'a' && b.zone !== 'b') }
    ].filter(g => g.bots.length);

    const edges = [];
    bots.forEach(b => {
      WF_HUBS.forEach(h => {
        let n = 0;
        b.chans.forEach((cnt, cid) => {
          const c = chanById.get(cid);
          if (c && c.hub === h.id) n += cnt;
        });
        if (n > 0) edges.push({ id: 'e:' + b.id + '>' + h.id, from: 'bot:' + b.id, to: 'hub:' + h.id, hub: h.id, count: n });
      });
    });
    chans.forEach(c => {
      if (c.count > 0) edges.push({ id: 'e:' + c.hub + '>' + c.id, from: 'hub:' + c.hub, to: 'chan:' + c.id, hub: c.hub, count: c.count });
    });
    const edgeIds = new Set(edges.map(e => e.id));

    return { bots, botById, chans, chanById, hubs, hubById, groups, edges, edgeIds, posts };
  }

  /* ── 좌표 ──
     봇은 두 열(A사단 / B사단·새로 합류)로 나눠 세로 길이를 줄이고,
     가운데 게시 흐름은 오른쪽 채널 묶음의 세로 가운데에 놓는다.
     칸 사이를 넉넉히 띄워 선이 지나갈 자리를 만든다. */
  function wfLayout(model) {
    const G = WF_G;
    const xA = G.padX;
    const xB = xA + G.botW + G.subGap;
    const xHub = xB + G.botW + G.colGap;
    const xCh = xHub + G.hubW + G.colGap;
    const nodes = new Map();
    const groups = [];
    const push = (kind, id, x, y, w, h) => nodes.set(kind + ':' + id, { kind, id, x, y, w, h });

    let ya = G.top;
    let yb = G.top;
    model.groups.forEach(g => {
      const left = g.key === 'a';
      const x = left ? xA : xB;
      let y = left ? ya : yb;
      groups.push({ x, y, w: G.botW, label: g.label, n: g.bots.length });
      y += G.groupHead;
      g.bots.forEach(b => { push('bot', b.id, x, y, G.botW, G.botH); y += G.botH + G.botGap; });
      y = y - G.botGap + G.groupGap;
      if (left) ya = y; else yb = y;
    });
    const botsBottom = Math.max(ya, yb);

    let cy = G.top;
    model.hubs.forEach(h => {
      const mine = model.chans.filter(c => c.hub === h.id);
      const start = cy;
      mine.forEach(c => { push('chan', c.id, xCh, cy, G.chanW, G.chanH); cy += G.chanH + G.chanGap; });
      const end = cy - G.chanGap;
      push('hub', h.id, xHub, Math.round((start + end) / 2 - G.hubH / 2), G.hubW, G.hubH);
      cy = end + G.hubSep;
    });
    const chansBottom = cy - G.hubSep;

    return {
      w: xCh + G.chanW + G.padX,
      h: Math.round(Math.max(botsBottom, chansBottom) + G.padY),
      nodes, groups,
      cols: [
        { x: xA, label: 'AI 봇', sub: '누가' },
        { x: xHub, label: '게시 흐름', sub: '어디로' },
        { x: xCh, label: '채널', sub: '어디에' }
      ]
    };
  }

  // 같은 노드에서 나가거나 들어오는 선은 포트 높이를 조금씩 나눠 겹침을 줄인다.
  function wfPortOffset(i, n, h) {
    if (!n || n < 2) return 0;
    const span = Math.min(34, h * 0.6);
    return -span / 2 + (span / (n - 1)) * i;
  }

  function wfEdgePath(a, b, sy, ty) {
    if (!a || !b) return '';
    const x1 = a.x + a.w, y1 = a.y + a.h / 2 + (sy || 0);
    const x2 = b.x, y2 = b.y + b.h / 2 + (ty || 0);
    const dx = Math.max(26, (x2 - x1) * 0.5);
    const r = n => Math.round(n * 10) / 10;
    return 'M' + r(x1) + ' ' + r(y1) + ' C' + r(x1 + dx) + ' ' + r(y1) + ', ' + r(x2 - dx) + ' ' + r(y2) + ', ' + r(x2) + ' ' + r(y2);
  }

  /* ── 팬 · 줌 ── */
  function wfViewState() {
    if (!state.wf.view) state.wf.view = { x: 0, y: 0, s: 1 };
    return state.wf.view;
  }

  function wfWrapEl() {
    return document.querySelector('#workflow .wf-wrap');
  }

  function wfApplyView() {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts) return;
    const v = wfViewState();
    const c = wrap.wfParts.canvas;
    c.style.transform = 'translate(' + Math.round(v.x) + 'px, ' + Math.round(v.y) + 'px) scale(' + v.s + ')';
    if (wrap.wfParts.pct) wrap.wfParts.pct.textContent = Math.round(v.s * 100) + '%';
  }

  // 세계 전체가 화면에 들어오게 맞춘다(↺ 버튼과 첫 진입).
  // 좁은 화면에서는 첫 진입만 읽을 수 있는 배율로 두고(옆으로 밀어서 봄),
  // ↺ 를 누르면 정말 전체가 보이게 줄인다.
  function wfFitView(all) {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts || !wrap.wfState) return;
    const v = wfViewState();
    const L = wrap.wfState.L;
    const W = wrap.wfParts.vp.clientWidth || 0;
    const H = wrap.wfParts.vp.clientHeight || 0;
    if (!W || !H) { v.x = 0; v.y = 0; v.s = 1; wfApplyView(); return; }
    const narrow = W < 660;
    const room = narrow ? (all ? 8 : 0.62) : 0;
    const s = Math.max(WF_ZOOM_MIN, room, Math.min(1, Math.min((W - 28) / L.w, (H - 28) / L.h)));
    v.s = Math.round(s * 100) / 100;
    if (v.s * L.w > W - 10) { v.x = 12; v.y = 12; }
    else {
      v.x = Math.round((W - L.w * v.s) / 2);
      v.y = Math.round((H - L.h * v.s) / 2);
    }
    wfApplyView();
  }

  // 화면의 한 점을 기준으로 확대·축소한다.
  function wfZoomAt(factor, cx, cy) {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts) return;
    const v = wfViewState();
    const W = wrap.wfParts.vp.clientWidth || 0;
    const H = wrap.wfParts.vp.clientHeight || 0;
    const px = (cx == null ? W / 2 : cx);
    const py = (cy == null ? H / 2 : cy);
    const s2 = Math.max(WF_ZOOM_MIN, Math.min(WF_ZOOM_MAX, v.s * factor));
    if (s2 === v.s) return;
    v.x = px - (px - v.x) * (s2 / v.s);
    v.y = py - (py - v.y) * (s2 / v.s);
    v.s = s2;
    wfApplyView();
  }

  function wfBindViewport(vp) {
    const pts = new Map();
    let drag = null;
    let pinch = null;

    const local = e => {
      const r = vp.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    vp.addEventListener('pointerdown', e => {
      if (e.target && e.target.closest && e.target.closest('.wf-zoom, .wf-node, .wf-props')) return;
      if (e.button != null && e.button !== 0) return;
      const p = local(e);
      pts.set(e.pointerId || 1, p);
      if (pts.size === 1) {
        const v = wfViewState();
        drag = { x: p.x, y: p.y, vx: v.x, vy: v.y };
        vp.classList.add('grabbing');
        if (vp.setPointerCapture && e.pointerId != null) { try { vp.setPointerCapture(e.pointerId); } catch (err) {} }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const v = wfViewState();
        pinch = {
          d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
          s: v.s, x: v.x, y: v.y
        };
        drag = null;
      }
    });

    vp.addEventListener('pointermove', e => {
      if (!dragging()) return;
      const p = local(e);
      if (pts.has(e.pointerId || 1)) pts.set(e.pointerId || 1, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const v = wfViewState();
        const s2 = Math.max(WF_ZOOM_MIN, Math.min(WF_ZOOM_MAX, pinch.s * (d / pinch.d)));
        v.x = cx - (pinch.cx - pinch.x) * (s2 / pinch.s);
        v.y = cy - (pinch.cy - pinch.y) * (s2 / pinch.s);
        v.s = s2;
        wfApplyView();
        return;
      }
      if (!drag) return;
      const v = wfViewState();
      v.x = drag.vx + (p.x - drag.x);
      v.y = drag.vy + (p.y - drag.y);
      wfApplyView();
    });

    function dragging() { return !!drag || (!!pinch && pts.size >= 2); }

    const end = e => {
      if (e && e.pointerId != null) pts.delete(e.pointerId);
      else pts.clear();
      if (pts.size < 2) pinch = null;
      if (!pts.size) { drag = null; vp.classList.remove('grabbing'); }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('pointerleave', e => { if (drag && !pts.size) end(e); });

    vp.addEventListener('wheel', e => {
      if (!e.deltaY) return;
      if (e.preventDefault) e.preventDefault();
      const p = local(e);
      wfZoomAt(e.deltaY < 0 ? 1.12 : 0.89, p.x, p.y);
    }, { passive: false });

    // 두 손가락 핀치(터치 이벤트를 함께 받는 브라우저용)
    let tdist = 0;
    vp.addEventListener('touchstart', e => {
      if (e.touches && e.touches.length === 2) {
        tdist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1;
      }
    }, { passive: true });
    vp.addEventListener('touchmove', e => {
      if (!e.touches || e.touches.length !== 2) return;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1;
      if (tdist) { wfZoomAt(d / tdist); tdist = d; }
      if (e.preventDefault) e.preventDefault();
    }, { passive: false });
  }

  /* ── 노드 · 선 ── */
  function wfNodeEl(kind, item, box) {
    const sel = state.wf.sel === kind + ':' + item.id;
    const b = el('button', 'wf-node wf-n-' + kind + (item.count ? '' : ' wf-zero') + (sel ? ' sel' : ''));
    b.type = 'button';
    b.dataset.kind = kind;
    b.dataset.id = item.id;
    b.style.left = box.x + 'px';
    b.style.top = box.y + 'px';
    b.style.width = box.w + 'px';
    b.style.height = box.h + 'px';
    const accent = item.color || '#94A3B8';
    // 색은 CSS 변수로 넘긴다(테마별로 진하기만 바꾸면 되도록).
    b.style.setProperty('--wf-accent', accent);
    b.style.setProperty('--wf-accent-soft', mixHex(accent, '#FFFFFF', 0.86));
    b.title = item.name + ' · ' + item.count + '건';
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    b.setAttribute('aria-label', WF_KIND_LABEL[kind] + ' ' + item.name + ' ' + item.count + '건');

    b.appendChild(el('i', 'wf-bar'));
    b.appendChild(el('span', 'wf-port wf-port-in'));
    b.appendChild(el('span', 'wf-port wf-port-out'));
    b.appendChild(el('span', 'wf-emoji', item.emoji || '🤖'));

    const meta = el('span', 'wf-meta');
    if (kind === 'hub') {
      // 흐름 카드는 이름이 길어서 타입 배지를 윗줄에 따로 둔다.
      meta.appendChild(el('em', 'wf-kind', WF_KIND_LABEL[kind]));
      meta.appendChild(el('b', 'wf-name', item.name));
    } else {
      const nameRow = el('span', 'wf-name-row');
      nameRow.appendChild(el('em', 'wf-kind', WF_KIND_LABEL[kind]));
      nameRow.appendChild(el('b', 'wf-name', item.name));
      meta.appendChild(nameRow);
    }

    let sub = '';
    if (kind === 'bot') sub = (item.lead ? '사단장' : (item.zone === 'a' ? 'A사단' : item.zone === 'b' ? 'B사단' : '새로 합류'));
    else if (kind === 'chan') sub = item.last ? officeAgo(item.last) : '기록 없음';
    else sub = '봇 ' + item.bots.size + ' · 채널 ' + item.chans.size;
    meta.appendChild(el('i', 'wf-sub', sub));
    b.appendChild(meta);

    const badge = el('span', 'wf-badge', item.count ? String(item.count) : '0');
    b.appendChild(badge);
    return b;
  }

  function wfStat(label, n, cls) {
    const s = el('div', 'wf-stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('b', '', String(n)));
    s.appendChild(el('i', '', label));
    return s;
  }

  function wfBarRow(label, n, ratio, onPick) {
    const row = el('button', 'wf-bar-row');
    row.type = 'button';
    row.addEventListener('click', onPick);
    const top = el('div', 'wf-bar-top');
    top.appendChild(el('b', '', label));
    top.appendChild(el('span', '', n + '건'));
    row.appendChild(top);
    const track = el('div', 'wf-bar-track');
    const fill = el('i', 'wf-bar-fill');
    fill.style.width = Math.max(6, Math.round(ratio * 100)) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  function wfPostEl(p) {
    const a = el('a', 'wf-post');
    a.href = p.url || '#';
    if (p.url) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    else a.addEventListener('click', ev => ev.preventDefault());
    const top = el('div', 'wf-post-top');
    top.appendChild(el('b', '', p.title));
    top.appendChild(el('i', '', officeAgo(p.ts)));
    a.appendChild(top);
    const meta = el('div', 'wf-post-meta');
    const ch = WF_CHAN_BY_ID[p.channelId];
    if (ch && ch.color) a.style.setProperty('--wf-accent', ch.color);
    meta.appendChild(el('span', 'wf-tag', (ch ? ch.emoji + ' ' + p.channelName : p.channelName)));
    meta.appendChild(el('span', 'wf-tag', (p.botEmoji || '🤖') + ' ' + p.botName));
    if (p.row) meta.appendChild(el('span', 'wf-tag wf-plain', SHEETS[p.sheet].short + '·' + p.tab + ' ' + p.row + '행'));
    a.appendChild(meta);
    return a;
  }

  // 연결 요약 — 이 노드가 어디로 이어져 있는지 한 줄 + 칩
  function wfConnRow(box, model, ref) {
    const wrap = el('div', 'wf-p-conn');
    wrap.appendChild(el('i', '', '연결 요약'));
    const chips = el('div', 'wf-p-chips');
    let text = '';
    if (ref.kind === 'bot') {
      const b = model.botById.get(ref.id);
      const hubs = new Set();
      if (b) b.chans.forEach((n, cid) => { const c = model.chanById.get(cid); if (c) hubs.add(c.hub); });
      text = hubs.size + '개 흐름 · ' + (b ? b.chans.size : 0) + '개 채널로 이어짐';
      hubs.forEach(hid => {
        const h = model.hubById.get(hid);
        if (!h) return;
        const chip = el('button', 'wf-p-chip');
        chip.type = 'button';
        chip.textContent = h.emoji + ' ' + h.short;
        chip.style.setProperty('--wf-accent', h.color);
        chip.addEventListener('click', () => wfSelect('hub', hid));
        chips.appendChild(chip);
      });
    } else if (ref.kind === 'chan') {
      const c = model.chanById.get(ref.id);
      const h = c ? model.hubById.get(c.hub) : null;
      text = (h ? h.name : '') + ' · ' + (c ? c.bots.size : 0) + '명이 올림';
      if (h) {
        const chip = el('button', 'wf-p-chip');
        chip.type = 'button';
        chip.textContent = h.emoji + ' ' + h.short;
        chip.style.setProperty('--wf-accent', h.color);
        chip.addEventListener('click', () => wfSelect('hub', h.id));
        chips.appendChild(chip);
      }
      if (c) c.bots.forEach((n, bid) => {
        const b = model.botById.get(bid);
        if (!b) return;
        const chip = el('button', 'wf-p-chip');
        chip.type = 'button';
        chip.textContent = b.emoji + ' ' + b.name;
        chip.style.setProperty('--wf-accent', b.color);
        chip.addEventListener('click', () => wfSelect('bot', bid));
        chips.appendChild(chip);
      });
    } else {
      const h = model.hubById.get(ref.id);
      text = (h ? h.chans.size : 0) + '개 채널 · ' + (h ? h.bots.size : 0) + '명이 올림';
      if (h) h.chans.forEach(cid => {
        const c = model.chanById.get(cid);
        if (!c) return;
        const chip = el('button', 'wf-p-chip');
        chip.type = 'button';
        chip.textContent = c.emoji + ' ' + c.name;
        chip.style.setProperty('--wf-accent', c.color);
        chip.addEventListener('click', () => wfSelect('chan', cid));
        chips.appendChild(chip);
      });
    }
    wrap.appendChild(el('b', '', text));
    if (chips.children.length) wrap.appendChild(chips);
    box.appendChild(wrap);
  }

  function wfBotMeta(model, id) {
    return model.bots.find(b => b.id === id) || OFFICE_FIXED.find(b => b.id === id) || null;
  }

  // 채널/봇별 건수 막대 (누르면 그 노드로 이동)
  function addBreakdown(box, model, own, by, label) {
    const map = new Map();
    own.forEach(p => {
      const k = by === 'chan' ? p.channelId : p.botId;
      map.set(k, (map.get(k) || 0) + 1);
    });
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
    box.appendChild(el('h4', 'wf-p-h', label + ' · ' + rows.length + '곳'));
    const max = rows[0] ? rows[0][1] : 1;
    rows.forEach(r => {
      const meta = by === 'chan' ? (WF_CHAN_BY_ID[r[0]] || {}) : (model.botById.get(r[0]) || {});
      box.appendChild(wfBarRow((meta.emoji || '•') + ' ' + (meta.name || r[0]), r[1], r[1] / max, () => wfSelect(by, r[0])));
    });
  }

  function addPosts(box, posts, pred) {
    const own = posts.filter(pred);
    box.appendChild(el('h4', 'wf-p-h', '게시 내역 · ' + own.length + '건'));
    own.slice(0, 14).forEach(p => box.appendChild(wfPostEl(p)));
    if (own.length > 14) box.appendChild(el('p', 'wf-p-more', '외 ' + (own.length - 14) + '건 더 있어요'));
    if (!own.length) box.appendChild(el('p', 'wf-p-empty', '기록이 없습니다.'));
  }

  // 오른쪽 '속성 · 게시 내역'
  function wfDetail(box, model, posts) {
    box.innerHTML = '';
    const ref = wfSelRef(state.wf.sel);

    const head = el('div', 'wf-p-head');
    head.appendChild(el('span', 'wf-p-kicker', '속성 · 게시 내역'));
    const x = el('button', 'wf-p-close', '×');
    x.type = 'button';
    x.title = '닫기';
    x.setAttribute('aria-label', '속성 패널 닫기');
    x.addEventListener('click', ev => {
      if (ev.stopPropagation) ev.stopPropagation();
      state.wf.sel = null;
      state.wf.open = false;
      wfPaint();
    });
    head.appendChild(x);
    head.addEventListener('click', () => {
      if (!ref) { state.wf.open = !state.wf.open; box.classList.toggle('open', !!state.wf.open); }
    });
    box.appendChild(head);
    box.classList.toggle('open', !!ref || !!state.wf.open);

    const body = el('div', 'wf-p-body');
    box.appendChild(body);

    if (!ref) {
      const id = el('div', 'wf-p-id');
      id.appendChild(el('span', 'wf-p-emoji', '🧭'));
      const t = el('div', 'wf-p-tit');
      t.appendChild(el('em', 'wf-kind wf-kind-all', 'ALL'));
      t.appendChild(el('b', '', '전체 흐름'));
      t.appendChild(el('i', '', '노드를 고르면 그 흐름만 펼쳐 보여요'));
      id.appendChild(t);
      body.appendChild(id);

      const stats = el('div', 'wf-p-stats');
      stats.appendChild(wfStat('게시·출고', posts.length, 'total'));
      stats.appendChild(wfStat('봇', model.bots.filter(b => b.count > 0).length, 'bot'));
      stats.appendChild(wfStat('채널', model.chans.filter(c => c.count > 0).length, 'chan'));
      body.appendChild(stats);

      const topChans = model.chans.filter(c => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
      if (topChans.length) {
        body.appendChild(el('h4', 'wf-p-h', '많이 올린 채널'));
        const max = topChans[0].count || 1;
        topChans.forEach(c => body.appendChild(wfBarRow(c.emoji + ' ' + c.name, c.count, c.count / max, () => wfSelect('chan', c.id))));
      }
      body.appendChild(el('h4', 'wf-p-h', '최근 게시·출고'));
      if (!posts.length) body.appendChild(el('p', 'wf-p-empty', '조건에 맞는 기록이 없습니다.'));
      posts.slice(0, 8).forEach(p => body.appendChild(wfPostEl(p)));
      if (posts.length > 8) body.appendChild(el('p', 'wf-p-more', '외 ' + (posts.length - 8) + '건 더 있어요'));
      return;
    }

    let item = null;
    let kindLabel = WF_KIND_LABEL[ref.kind];
    if (ref.kind === 'bot') item = wfBotMeta(model, ref.id);
    else if (ref.kind === 'chan') item = model.chanById.get(ref.id) || WF_CHAN_BY_ID[ref.id];
    else item = model.hubById.get(ref.id) || WF_HUB_BY_ID[ref.id];

    const id = el('div', 'wf-p-id');
    id.appendChild(el('span', 'wf-p-emoji', (item && item.emoji) || '•'));
    const t = el('div', 'wf-p-tit');
    t.appendChild(el('em', 'wf-kind', kindLabel));
    t.appendChild(el('b', '', (item && item.name) || ref.id));
    let line = '';
    if (ref.kind === 'bot') line = ((item && item.lead) ? '사단장' : (item && item.zone === 'a' ? 'A사단' : item && item.zone === 'b' ? 'B사단' : '새로 합류')) + ' · 게시 ' + posts.filter(p => p.botId === ref.id).length + '건';
    else if (ref.kind === 'chan') line = ((WF_HUB_BY_ID[(item && item.hub) || ''] || {}).name || '') + ' · 게시 ' + posts.filter(p => p.channelId === ref.id).length + '건';
    else line = '게시 ' + posts.filter(p => p.hubId === ref.id).length + '건';
    t.appendChild(el('i', '', line));
    id.appendChild(t);
    body.appendChild(id);

    wfConnRow(body, model, ref);

    if (ref.kind === 'bot') {
      const own = posts.filter(p => p.botId === ref.id);
      if (!own.length) { body.appendChild(el('p', 'wf-p-empty', '이 기간·검색에는 이 봇의 게시 기록이 없습니다.')); return; }
      addBreakdown(body, model, own, 'chan', '어디에 올렸나');
      addPosts(body, posts, p => p.botId === ref.id);
      return;
    }
    if (ref.kind === 'chan') {
      const own = posts.filter(p => p.channelId === ref.id);
      if (!own.length) { body.appendChild(el('p', 'wf-p-empty', '이 기간·검색에는 이 채널의 게시 기록이 없습니다.')); return; }
      addBreakdown(body, model, own, 'bot', '누가 올렸나');
      addPosts(body, posts, p => p.channelId === ref.id);
      return;
    }
    const own = posts.filter(p => p.hubId === ref.id);
    if (!own.length) { body.appendChild(el('p', 'wf-p-empty', '이 기간·검색에는 이 흐름의 기록이 없습니다.')); return; }
    addBreakdown(body, model, own, 'chan', '어느 채널로 나갔나');
    addPosts(body, posts, p => p.hubId === ref.id);
  }

  function wfActiveSet(model, sel) {
    const ref = wfSelRef(sel);
    if (!ref) return null;
    const nodes = new Set([ref.kind + ':' + ref.id]);
    const edges = new Set();
    const edge = (from, to) => { const id = 'e:' + from + '>' + to; if (model.edgeIds.has(id)) edges.add(id); };

    if (ref.kind === 'bot') {
      const b = model.botById.get(ref.id);
      if (!b) return { nodes, edges };
      b.chans.forEach((n, cid) => {
        const c = model.chanById.get(cid);
        if (!c) return;
        nodes.add('chan:' + cid);
        nodes.add('hub:' + c.hub);
        edge(b.id, c.hub);
        edge(c.hub, cid);
      });
      return { nodes, edges };
    }
    if (ref.kind === 'chan') {
      const c = model.chanById.get(ref.id);
      if (!c) return { nodes, edges };
      nodes.add('hub:' + c.hub);
      edge(c.hub, c.id);
      c.bots.forEach((n, bid) => {
        nodes.add('bot:' + bid);
        edge(bid, c.hub);
      });
      return { nodes, edges };
    }
    const h = model.hubById.get(ref.id);
    if (!h) return { nodes, edges };
    h.chans.forEach(cid => { nodes.add('chan:' + cid); edge(h.id, cid); });
    h.bots.forEach((n, bid) => { nodes.add('bot:' + bid); edge(bid, h.id); });
    return { nodes, edges };
  }

  function wfApplyFocus() {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts || !wrap.wfState) return;
    const canvas = wrap.wfParts.canvas;
    const set = wfActiveSet(wrap.wfState.model, wfHoverSel || state.wf.sel);
    canvas.classList.toggle('wf-focus', !!set);
    canvas.querySelectorAll('.wf-edge').forEach(p => {
      p.classList.toggle('on', !!set && set.edges.has(p.getAttribute('data-eid')));
    });
    canvas.querySelectorAll('.wf-node').forEach(n => {
      const key = n.dataset.kind + ':' + n.dataset.id;
      const lit = !!set && set.nodes.has(key);
      n.classList.toggle('dim', !!set && !lit);
      n.classList.toggle('lit', lit);
    });
  }

  function wfSelect(kind, id) {
    state.wf.sel = kind + ':' + id;
    state.wf.open = true;
    wfPaint();
    wfRevealDetail();
  }

  // 좁은 화면에서는 상세 패널이 아래 시트라, 고르면 그 시트를 위로 올리고
  // 고른 노드가 시트에 가리지 않게 캔버스를 그쪽으로 옮긴다.
  function wfRevealDetail() {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts) return;
    const box = wrap.wfParts.props;
    if (!box || !box.classList) return;
    box.classList.toggle('open', !!state.wf.sel || !!state.wf.open);
    const vp = wrap.wfParts.vp;
    const W = vp.clientWidth || 0;
    if (W >= 660 || !state.wf.sel || !wrap.wfState) return;
    const b = wrap.wfState.L.nodes.get(state.wf.sel);
    if (!b) return;
    const v = wfViewState();
    const H = vp.clientHeight || 0;
    v.x = Math.round(W / 2 - (b.x + b.w / 2) * v.s);
    v.y = Math.round(H * 0.24 - (b.y + b.h / 2) * v.s);
    wfApplyView();
  }

  function wfWrap() {
    const view = el('section', 'wf-wrap');
    view.setAttribute('aria-label', '사단 워크플로우 캔버스');

    /* 상단 슬림 툴바 */
    const bar = el('div', 'wf-topbar');
    const seg = el('div', 'wf-seg');
    [['all', '전체'], ['today', '오늘'], ['24h', '최근 24시간']].forEach(o => {
      const b = el('button', 'wf-chip' + (state.wf.period === o[0] ? ' on' : ''), o[1]);
      b.type = 'button';
      b.dataset.period = o[0];
      b.addEventListener('click', () => {
        state.wf.period = o[0];
        seg.querySelectorAll('.wf-chip').forEach(x => x.classList.toggle('on', x.dataset.period === o[0]));
        wfPaint();
      });
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    const search = el('label', 'wf-search');
    search.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const inp = el('input');
    inp.type = 'search';
    inp.className = 'wf-q';
    inp.placeholder = '봇 · 채널 · 제목 검색';
    inp.value = state.wf.q || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => { state.wf.q = inp.value; wfPaint(); });
    search.appendChild(inp);
    bar.appendChild(search);

    const sub = el('span', 'wf-sum', '');
    bar.appendChild(sub);

    const reset = el('button', 'wf-reset', '↺ 초기화');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      state.wf.period = 'all';
      state.wf.q = '';
      state.wf.sel = null;
      state.wf.open = false;
      seg.querySelectorAll('.wf-chip').forEach(x => x.classList.toggle('on', x.dataset.period === 'all'));
      inp.value = '';
      wfPaint();
      wfFitView(true);
    });
    bar.appendChild(reset);
    view.appendChild(bar);

    /* 캔버스 + 속성 패널 */
    const main = el('div', 'wf-main');
    const vp = el('div', 'wf-canvas-vp');
    const canvas = el('div', 'wf-canvas');
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', '워크플로우 노드 캔버스');
    vp.appendChild(canvas);

    const zoom = el('div', 'wf-zoom');
    const zOut = el('button', 'wf-zbtn', '−');
    zOut.type = 'button';
    zOut.title = '축소';
    zOut.setAttribute('aria-label', '축소');
    zOut.addEventListener('click', () => wfZoomAt(0.85));
    const pct = el('span', 'wf-zpct', '100%');
    const zIn = el('button', 'wf-zbtn', '+');
    zIn.type = 'button';
    zIn.title = '확대';
    zIn.setAttribute('aria-label', '확대');
    zIn.addEventListener('click', () => wfZoomAt(1.18));
    const zFit = el('button', 'wf-zbtn wf-zfit', '↺');
    zFit.type = 'button';
    zFit.title = '전체 보기';
    zFit.setAttribute('aria-label', '전체 보기');
    zFit.addEventListener('click', () => wfFitView(true));
    zoom.appendChild(zOut);
    zoom.appendChild(pct);
    zoom.appendChild(zIn);
    zoom.appendChild(zFit);
    vp.appendChild(zoom);
    main.appendChild(vp);

    const props = el('aside', 'wf-props');
    props.setAttribute('aria-label', '속성 · 게시 내역');
    main.appendChild(props);
    view.appendChild(main);

    canvas.addEventListener('click', e => {
      const hitEdge = e.target && e.target.closest ? e.target.closest('.wf-edge-hit') : null;
      if (hitEdge) {
        const hub = hitEdge.getAttribute('data-hub');
        if (hub) { state.wf.sel = 'hub:' + hub; state.wf.open = true; wfPaint(); wfRevealDetail(); }
        return;
      }
      const n = e.target && e.target.closest ? e.target.closest('.wf-node') : null;
      if (!n) return;
      const key = n.dataset.kind + ':' + n.dataset.id;
      state.wf.sel = state.wf.sel === key ? null : key;
      state.wf.open = true;
      wfPaint();
      wfRevealDetail();
    });
    const hover = (e, on) => {
      const n = e.target && e.target.closest ? e.target.closest('.wf-node') : null;
      if (!n) return;
      if (!on && e.relatedTarget && n.contains(e.relatedTarget)) return;
      wfHoverSel = on ? n.dataset.kind + ':' + n.dataset.id : null;
      wfApplyFocus();
    };
    canvas.addEventListener('mouseover', e => hover(e, true));
    canvas.addEventListener('mouseout', e => hover(e, false));
    canvas.addEventListener('focusin', e => hover(e, true));
    canvas.addEventListener('focusout', e => hover(e, false));
    wfBindViewport(vp);

    view.wfParts = { canvas, vp, props, sub, pct };
    return view;
  }

  function wfPaint(fit) {
    const wrap = wfWrapEl();
    if (!wrap || !wrap.wfParts) return;
    wfHoverSel = null;
    const { canvas, props, sub } = wrap.wfParts;
    const all = wfParse(wfMsgs());
    const posts = wfFilter(all);
    const model = wfModel(posts);
    const L = wfLayout(model);

    const nBot = model.bots.filter(b => b.count > 0).length;
    const nChan = model.chans.filter(c => c.count > 0).length;
    const summary = posts.length + '건 · 봇 ' + nBot + ' · 채널 ' + nChan;
    if (sub) sub.textContent = summary + (state.wf.q ? ' · “' + state.wf.q + '”' : '');
    const head = $('#chatSub');
    if (head && state.view === 'workflow') head.textContent = '누가 · 어디에 · 무엇을 올렸는지 — 시트 기록에서 자동으로';

    canvas.innerHTML = '';
    canvas.style.width = L.w + 'px';
    canvas.style.height = L.h + 'px';
    canvas.classList.toggle('wf-empty', posts.length === 0);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'wf-edges');
    svg.setAttribute('viewBox', '0 0 ' + L.w + ' ' + L.h);
    svg.setAttribute('width', String(L.w));
    svg.setAttribute('height', String(L.h));
    svg.setAttribute('aria-hidden', 'true');
    const outMap = new Map();
    const inMap = new Map();
    model.edges.forEach(e => {
      if (!outMap.has(e.from)) outMap.set(e.from, []);
      outMap.get(e.from).push(e);
      if (!inMap.has(e.to)) inMap.set(e.to, []);
      inMap.get(e.to).push(e);
    });
    const pathOf = (e, sy, ty) => {
      const a = L.nodes.get(e.from);
      const b = L.nodes.get(e.to);
      if (!a || !b) return null;
      const outs = outMap.get(e.from);
      const ins = inMap.get(e.to);
      return wfEdgePath(a, b,
        wfPortOffset(outs.indexOf(e), outs.length, a.h),
        wfPortOffset(ins.indexOf(e), ins.length, b.h));
    };
    model.edges.forEach(e => {
      const d = pathOf(e);
      if (!d) return;
      const color = (model.hubById.get(e.hub) || {}).color || '#94A3B8';
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'wf-edge');
      p.setAttribute('data-eid', e.id);
      p.setAttribute('data-hub', e.hub);
      p.setAttribute('d', d);
      p.style.setProperty('--wf-edge-base', mixHex(color, '#E4E8EF', 0.55));
      p.style.setProperty('--wf-edge-hot', color);
      p.setAttribute('stroke-width', String(Math.round((1.3 + Math.min(3, e.count) * 0.42) * 10) / 10));
      svg.appendChild(p);
    });
    // 보이는 선은 가늘어서 누르기 어렵다 → 같은 자리에 투명한 넓은 선을 겹쳐 둔다.
    model.edges.forEach(e => {
      const d = pathOf(e);
      if (!d) return;
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('class', 'wf-edge-hit');
      hit.setAttribute('data-eid', e.id);
      hit.setAttribute('data-hub', e.hub);
      hit.setAttribute('d', d);
      svg.appendChild(hit);
    });
    canvas.appendChild(svg);

    // 열 이름표
    L.cols.forEach(c => {
      const h = el('div', 'wf-col');
      h.style.left = c.x + 'px';
      h.appendChild(el('b', '', c.label));
      h.appendChild(el('i', '', c.sub));
      canvas.appendChild(h);
    });

    L.groups.forEach(g => {
      const d = el('div', 'wf-group');
      d.style.left = g.x + 'px';
      d.style.top = g.y + 'px';
      d.style.width = g.w + 'px';
      d.appendChild(el('b', '', g.label));
      d.appendChild(el('span', '', g.n + '명'));
      canvas.appendChild(d);
    });

    model.bots.forEach(b => {
      const box = L.nodes.get('bot:' + b.id);
      if (box) canvas.appendChild(wfNodeEl('bot', b, box));
    });
    model.hubs.forEach(h => {
      const box = L.nodes.get('hub:' + h.id);
      if (box) canvas.appendChild(wfNodeEl('hub', h, box));
    });
    model.chans.forEach(c => {
      const box = L.nodes.get('chan:' + c.id);
      if (box) canvas.appendChild(wfNodeEl('chan', c, box));
    });

    if (!posts.length) {
      const note = el('div', 'wf-empty-note');
      note.appendChild(el('b', '', '아직 이어 그릴 게시·출고 기록이 없습니다'));
      note.appendChild(el('span', '', '시트에 [완료]·발행·업로드·등록 같은 보고가 쌓이면 선이 저절로 이어져요.'));
      canvas.appendChild(note);
    }

    wrap.wfState = { model, L };
    wfDetail(props, model, posts);
    wfApplyFocus();
    if (fit) wfFitView();
    else wfApplyView();
    wfRevealDetail();
  }

  function wfMsgs() {
    const data = state.rooms[state.roomId];
    return data ? data.msgs : [];
  }

  function renderWorkflow() {
    const box = $('#workflow');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '';
    if (!state.wf.view) state.wf.view = { x: 0, y: 0, s: 1 };
    box.appendChild(wfWrap());
    wfPaint(!state.wf.fitted);
    state.wf.fitted = true;
    const lbl = $('#tabFilterLabel');
    if (lbl) lbl.textContent = '게시 흐름';
  }

  function renderOffice() {
    const box = $('#office');
    if (!box) return;
    box.hidden = false;
    const snap = officeSnapshot(officeMsgs());
    state.officeSnap = snap;
    box.dataset.skin = state.skin || 'day';
    const keepScroll = box.scrollTop;
    box.innerHTML = '';
    // 사단 오피스는 등각 지도 한 장만 — 워크플로우는 별도 방(🔀)으로 나갔다.
    box.appendChild(officeWrap(snap));
    if (keepScroll) box.scrollTop = keepScroll;

    const sub = $('#chatSub');
    if (sub) {
      sub.textContent = snap.counts.total + '명 · 열일 ' + snap.counts.working + ' · 활동 ' + snap.counts.active +
        ' · 대기 ' + snap.counts.waiting + ' · 휴식 ' + snap.counts.idle;
    }
    const lbl = $('#tabFilterLabel');
    if (lbl) lbl.textContent = '근무 현황';
  }

  function openSeatSheet(p) {
    const snap = state.officeSnap || officeSnapshot(officeMsgs());
    const body = $('#seatSheetBody');
    if (!body) return;
    body.innerHTML = '';

    const head = el('div', 'ss-head');
    const animal = officeAnimal(p);
    const av = el('div', 'ss-av');
    av.style.background = 'linear-gradient(160deg, ' + mixHex(animal.fur, '#FFFFFF', 0.62) + ', ' + mixHex(animal.fur, '#FFFFFF', 0.3) + ')';
    av.innerHTML = '<svg class="ss-pet" viewBox="40 -4 70 112" aria-hidden="true">' + petSvg(animal.kind, animal.fur, {}) + '</svg>';
    head.appendChild(av);
    const titles = el('div', 'ss-titles');
    const nm = el('b', '', p.name);
    nm.id = 'seatSheetName';
    titles.appendChild(nm);
    titles.appendChild(el('span', '', (animal.label ? animal.label + ' · ' : '') + p.role));
    head.appendChild(titles);
    const chip = el('span', 'ss-chip st-' + p.status, officeBadge(p, p.status));
    head.appendChild(chip);
    body.appendChild(head);

    if (p.id === 'ceo') {
      body.appendChild(el('p', 'ss-lead', '사단 전체 근무 현황입니다. 캐릭터를 누르면 그 대원의 최근 기록을 볼 수 있어요.'));
      const stats = el('div', 'ss-stats');
      const mk = (cls, n, label) => {
        const s = el('div', 'ss-stat ' + cls);
        s.appendChild(el('b', '', String(n)));
        s.appendChild(el('i', '', label));
        return s;
      };
      stats.appendChild(mk('total', snap.counts.total, '총 대원'));
      stats.appendChild(mk('working', snap.counts.working, '열일 중'));
      stats.appendChild(mk('active', snap.counts.active, '활동 중'));
      stats.appendChild(mk('waiting', snap.counts.waiting, '대기 중'));
      stats.appendChild(mk('idle', snap.counts.idle, '휴식 중'));
      body.appendChild(stats);
      body.appendChild(el('h4', 'ss-h', '최근 소식'));
      const list = el('div', 'ss-recent');
      const latest = snap.all.filter(x => x.id !== 'ceo' && x.last).sort((a, b) => b.last.ts - a.last.ts).slice(0, 3);
      if (!latest.length) list.appendChild(el('p', 'ss-empty', '아직 올라온 기록이 없습니다.'));
      latest.forEach(x => {
        const rec = el('div', 'ss-rec');
        const top = el('div', 'ss-rec-top');
        top.appendChild(el('b', '', (x.emoji || '🙂') + ' ' + x.name));
        top.appendChild(el('span', '', officeAgo(x.last.ts)));
        rec.appendChild(top);
        rec.appendChild(el('p', '', x.last.title || (x.last.body || '').slice(0, 80) || '(제목 없음)'));
        rec.appendChild(el('span', 'ss-rec-meta', SHEETS[x.last.sheet].short + '·' + x.last.tab));
        list.appendChild(rec);
      });
      body.appendChild(list);
    } else {
      const grid = el('div', 'ss-grid');
      const cell = (label, value) => {
        const d = el('div');
        d.appendChild(el('i', '', label));
        d.appendChild(el('b', '', value));
        return d;
      };
      grid.appendChild(cell('상태', officeStatusText(p, p.status)));
      grid.appendChild(cell('마지막 활동', p.last ? (fmtClock(p.last.ts) + ' · ' + officeAgo(p.last.ts)) : '기록 없음'));
      grid.appendChild(cell('남긴 기록', p.count ? '최근 ' + p.count + '건' : '없음'));
      body.appendChild(grid);

      body.appendChild(el('h4', 'ss-h', '최근 시트 기록'));
      const list = el('div', 'ss-recent');
      if (!p.recent.length) list.appendChild(el('p', 'ss-empty', '아직 이 대원 이름으로 남은 기록이 없습니다.'));
      p.recent.slice(0, 3).forEach(m => {
        const rec = el('div', 'ss-rec');
        const top = el('div', 'ss-rec-top');
        top.appendChild(el('b', '', m.title || '(제목 없음)'));
        top.appendChild(el('span', '', fmtClock(m.ts)));
        rec.appendChild(top);
        const text = String(m.body || '').replace(/\s+/g, ' ').trim();
        if (text) rec.appendChild(el('p', '', text.slice(0, 96) + (text.length > 96 ? '…' : '')));
        rec.appendChild(el('span', 'ss-rec-meta', SHEETS[m.sheet].short + '·' + m.tab + (m.row ? ' · ' + m.row + '행' : '')));
        list.appendChild(rec);
      });
      body.appendChild(list);
    }

    $('#seatSheetBackdrop').hidden = false;
    $('#seatSheet').scrollTop = 0;
  }

  function closeSeatSheet() {
    const bd = $('#seatSheetBackdrop');
    if (bd) bd.hidden = true;
  }

  // 오피스·워크플로우 패널은 [hidden] 으로도 감춰지므로 뷰에 맞춰 직접 켜고 끈다.
  function syncOfficeVisible() {
    const box = $('#office');
    if (box) box.hidden = state.view !== 'office';
    const wf = $('#workflow');
    if (wf) wf.hidden = state.view !== 'workflow';
  }

  /* ───────── 새로고침/폴링 ───────── */
  let pollTimer = null;
  async function refresh(opts = {}) {
    if (state.loading) return;
    state.loading = true;
    const btn = $('#btnRefresh');
    btn.classList.add('spin');
    if (/기록 중/.test($('#composerStatus').textContent)) $('#composerStatus').textContent = '';
    try {
      const room = roomById(state.roomId);
      const before = (state.rooms[room.id] || { msgs: [] }).msgs;
      const beforeKeys = new Set(before.map(m => m.key));
      const msgs = await loadRoom(room, { limit: 80 });
      const added = msgs.filter(m => !beforeKeys.has(m.key));
      const isOffice = room.kind === 'office';
      const isWf = room.kind === 'workflow';
      const box = $('#messages');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
      if (isOffice) renderOffice();
      else if (isWf) { if ($('#workflow .wf-wrap')) wfPaint(); else renderWorkflow(); }
      else renderMessages();
      renderRooms();
      if (added.length && !opts.silent) {
        toast(`${added.length}건 새 기록을 불러왔습니다.`);
        if (!isOffice && !isWf) scrollToBottom(true);
      } else if (added.length && opts.silent) {
        if (isOffice || isWf) { /* 오피스·워크플로우는 자동 갱신만 */ }
        else if (nearBottom) scrollToBottom(true);
        else { $('#jumpCount').textContent = added.length; $('#jumpNew').hidden = false; }
      } else if (opts.manual) {
        toast('최신 상태로 새로고침했습니다.');
      }
      markSeen(room.id);
    } catch (err) {
      console.error(err);
      toast(err.message || '불러오지 못했습니다.', true);
      setConn(false);
    } finally {
      state.loading = false;
      btn.classList.remove('spin');
      schedulePoll();
    }
  }

  function schedulePoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const sec = Number(state.config.pollSec) || 0;
    if (!sec || !api.isLive()) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      if (state.view !== 'chat' && state.view !== 'office' && state.view !== 'workflow') return;
      refresh({ silent: true });
    }, sec * 1000);
  }

  function setConn(ok) {
    const n = $('#connState');
    if (window.SADAN_GAS_MODE) {
      n.className = 'conn ' + (ok ? 'live' : 'off');
      n.textContent = ok ? '시트 연결됨' : '연결 확인 필요';
      $('#modeText').textContent = 'Apps Script 단독 배포로 실행 중';
      $('#btnModeToggle').textContent = '설정';
      return;
    }
    if (!api.isLive()) {
      n.className = 'conn demo';
      n.textContent = '데모 모드';
      $('#modeText').textContent = '데모 데이터로 둘러보는 중';
      $('#btnModeToggle').textContent = '연결하기';
    } else {
      n.className = 'conn ' + (ok ? 'live' : 'off');
      n.textContent = ok ? '시트 연결됨' : '연결 확인 필요';
      $('#modeText').textContent = ok ? 'Apps Script 웹앱과 연결됨' : '설정에서 연결을 확인하세요';
      $('#btnModeToggle').textContent = '설정';
    }
  }

  /* ───────── 입력/전송 ───────── */
  function targetLabel() {
    const s = SHEETS[state.target.sheet];
    return `${s.short}사단 · ${state.target.tab}`;
  }
  function syncComposer() {
    $('#targetSheetLabel').textContent = targetLabel();
    $('#targetDot').className = 'dot ' + SHEETS[state.target.sheet].tone;
    const tags = tagsForTarget();
    if (!tags.includes(state.tag)) state.tag = tags[0];
    $('#btnTargetTag').textContent = state.tag;
    $('#targetWarn').hidden = state.targetKind !== 'table';
  }

  async function refreshTargetKind() {
    try {
      const info = await api.info(state.target.sheet, state.target.tab);
      state.targetKind = info.kind || 'unknown';
    } catch (e) { state.targetKind = 'unknown'; }
    syncComposer();
  }

  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 132) + 'px';
    // 텍스트가 없어도 첨부파일이 있으면 전송할 수 있다.
    $('#btnSend').disabled = state.uploading || (!t.value.trim() && !state.attach.length);
  }

  /* ───────── 첨부(+) ───────── */
  function attachTotal() {
    return state.attach.reduce((s, a) => s + (a.size || 0), 0);
  }
  function openAttachMenu() {
    const m = $('#attachMenu');
    if (!m || state.uploading) return;
    m.hidden = false;
    $('#attachBtn').classList.add('on');
  }
  function closeAttachMenu() {
    const m = $('#attachMenu');
    if (m) m.hidden = true;
    const b = $('#attachBtn');
    if (b) b.classList.remove('on');
  }
  function toggleAttachMenu() {
    const m = $('#attachMenu');
    if (!m) return;
    if (m.hidden) openAttachMenu(); else closeAttachMenu();
  }

  function addFiles(list) {
    const files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    const rejected = [];
    files.forEach(file => {
      const name = file.name || '첨부파일';
      const size = Number(file.size) || 0;
      if (size > MAX_ATTACH_FILE) {
        rejected.push(name + ' (' + fmtSize(size) + ' — 파일당 15MB 초과)');
        return;
      }
      if (state.attach.some(a => a.name === name && a.size === size)) return;      // 같은 파일 두 번 붙이기 방지
      if (attachTotal() + size > MAX_ATTACH_TOTAL) {
        rejected.push(name + ' (합계 20MB 초과)');
        return;
      }
      const item = { file, name, size, mime: file.type || '', thumb: '' };
      // 이미지는 미리보기 썸네일(6MB 이하만 — 큰 파일은 메모리를 아끼기 위해 아이콘)
      if (item.mime.indexOf('image/') === 0 && size <= 6 * 1024 * 1024) {
        try { item.thumb = URL.createObjectURL(file); } catch (e) { item.thumb = ''; }
      }
      state.attach.push(item);
    });
    renderPending();
    if (rejected.length) {
      toast('첨부하지 못한 파일: ' + rejected.join(', '), true);
    } else {
      toast('첨부 ' + state.attach.length + '개 — 전송 버튼을 누르면 Drive에 올라갑니다.');
    }
  }

  function removeAttach(idx) {
    const a = state.attach[idx];
    if (!a) return;
    if (a.thumb) { try { URL.revokeObjectURL(a.thumb); } catch (e) { /* 무시 */ } }
    state.attach.splice(idx, 1);
    renderPending();
  }

  function clearAttach() {
    state.attach.forEach(a => { if (a.thumb) { try { URL.revokeObjectURL(a.thumb); } catch (e) { /* 무시 */ } } });
    state.attach = [];
    renderPending();
  }

  function renderPending() {
    const bar = $('#attachPending');
    if (!bar) return;
    bar.innerHTML = '';
    if (!state.attach.length) {
      bar.hidden = true;
      autoGrow();
      return;
    }
    bar.hidden = false;
    bar.appendChild(el('div', 'attach-pending-note', state.attach.length + '개 · ' + fmtSize(attachTotal())));
    state.attach.forEach((a, idx) => {
      const chip = el('div', 'attach-chip');
      if (a.thumb) {
        const img = el('img', 'attach-thumb');
        img.src = a.thumb;
        img.alt = a.name;
        chip.appendChild(img);
      } else {
        chip.appendChild(el('div', 'attach-ico', fileIcon(a.name, a.mime)));
      }
      const meta = el('div', 'meta');
      meta.appendChild(el('div', 'nm', a.name));
      meta.appendChild(el('div', 'sz', fmtSize(a.size)));
      chip.appendChild(meta);
      const rm = el('button', 'rm', '×');
      rm.type = 'button';
      rm.title = '첨부 삭제';
      rm.addEventListener('click', (e) => { e.stopPropagation(); removeAttach(idx); });
      chip.appendChild(rm);
      bar.appendChild(chip);
    });
    autoGrow();
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') { reject(new Error('이 브라우저에서는 파일을 읽을 수 없습니다.')); return; }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('파일을 읽지 못했습니다: ' + (file && file.name)));
      r.readAsDataURL(file);
    });
  }

  async function send() {
    const input = $('#input');
    const text = input.value.trim();
    const pending = state.attach.slice();
    if (state.uploading) return;
    if (!text && !pending.length) return;
    if (state.targetKind === 'table') {
      const ok = await askConfirm('표 형식 탭입니다',
        '‘' + state.target.tab + '’ 탭은 기록용 표(시간·제목·내용·작성자)가 아닌 것 같습니다. 표 형식이면 열이 어긋나게 들어갑니다. 그래도 보낼까요?');
      if (!ok) return;
    }
    const btn = $('#btnSend');
    const status = $('#composerStatus');
    const title = titleForTarget(state.tag);
    btn.disabled = true;
    status.className = 'composer-status';
    let attachments = [];
    try {
      if (pending.length) {
        state.uploading = true;
        closeAttachMenu();
        $('#attachBtn').disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        btn.title = '업로드 중…';
        for (let i = 0; i < pending.length; i++) {
          const a = pending[i];
          status.textContent = '업로드 중… ' + (i + 1) + '/' + pending.length + ' · ' + a.name + ' (' + fmtSize(a.size) + ')';
          const dataUrl = await readAsDataURL(a.file);
          const comma = dataUrl.indexOf(',');
          const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          const up = await api.upload({ name: a.name, mimeType: a.mime || 'application/octet-stream', dataBase64: b64 });
          attachments.push({ name: up.name || a.name, url: up.url, demo: !!up.demo });
        }
        state.uploading = false;
        $('#attachBtn').disabled = false;
        btn.innerHTML = SEND_ICON;
        btn.title = '전송';
      }
      const attachBlock = attachments.map(a => '📎 [' + a.name + '](' + a.url + ')').join('\n');
      const body = text ? (attachBlock ? text + '\n\n' + attachBlock : text) : attachBlock;
      status.textContent = '기록 중…';
      const res = await api.append({
        sheet: state.target.sheet,
        tab: state.target.tab,
        title,
        body,
        author: state.config.author,
        tag: state.tag,
        link: attachments.length ? attachments[0].url : ''
      });
      input.value = '';
      clearAttach();
      autoGrow();
      if (res.demo) {
        // 데모: 화면에만 추가
        appendLocal(title, body, 0);
        status.textContent = '데모 모드 — 화면에만 표시했습니다. 실제 시트·Drive에는 저장되지 않았습니다.';
        toast('데모 모드: 실제 시트·드라이브에는 저장되지 않았어요.');
      } else {
        const msg = SHEETS[state.target.sheet].name + ' · ' + state.target.tab + ' ' + (res.row ? res.row + '행' : '') + '에 기록했습니다.';
        status.textContent = msg;
        toast(state.target.tab + ' ' + (res.row ? res.row + '행' : '') + '에 ' + (attachments.length ? '첨부와 함께 ' : '') + '기록했습니다.');
        const shown = activeTabs(roomById(state.roomId)).some(g =>
          g.sheet === state.target.sheet && g.tabs.indexOf(state.target.tab) >= 0);
        if (shown) {
          await refresh({ silent: true });
          scrollToBottom(true);
        } else {
          appendLocal(title, body, res.row);
          status.textContent = msg + ' (이 방에 없는 탭이라 새로고침하면 사라집니다)';
        }
      }
    } catch (err) {
      console.error(err);
      state.uploading = false;
      $('#attachBtn').disabled = false;
      btn.innerHTML = SEND_ICON;
      btn.title = '전송';
      status.className = 'composer-status err';
      status.textContent = err.message || '전송에 실패했습니다.';
      toast(err.message || '전송에 실패했습니다.', true);
      autoGrow();
    }
  }

  function appendLocal(title, text, row) {
    const m = normalize({
      t: nowStamp(), title, body: text, author: state.config.author, row: row || 0, idx: Date.now()
    }, state.target.sheet, state.target.tab);
    m.type = 'instruction';
    m.status = 'wait';
    const data = state.rooms[state.roomId];
    if (!data) return;
    data.msgs.push(m);
    data.msgs.sort((a, b) => a.ts - b.ts);
    renderMessages();
    scrollToBottom(true);
    markSeen(state.roomId);
  }

  /* ───────── 토스트 ───────── */  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  /* ───────── 모달 ───────── */
  function openModal({ title, body, foot, onMount }) {
    $('#modalTitle').textContent = title;
    const b = $('#modalBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.appendChild(el('div', '', body)); else if (body) b.appendChild(body);
    const f = $('#modalFoot');
    f.innerHTML = '';
    (foot || []).forEach(item => {
      const btn = el('button', 'btn ' + (item.cls || ''), item.label);
      btn.type = 'button';
      btn.addEventListener('click', () => item.onClick(btn));
      f.appendChild(btn);
    });
    $('#modalBackdrop').hidden = false;
    if (onMount) onMount();
  }
  function closeModal() { $('#modalBackdrop').hidden = true; }

  function askConfirm(title, text) {
    return new Promise((resolve) => {
      const wrap = el('div');
      const p = el('div', 'help', text);
      p.style.fontSize = '13px';
      wrap.appendChild(p);
      openModal({
        title,
        body: wrap,
        foot: [
          { label: '취소', cls: 'ghost', onClick: () => { closeModal(); resolve(false); } },
          { label: '그래도 보내기', onClick: () => { closeModal(); resolve(true); } }
        ]
      });
    });
  }

  /* 설정 */
  function openSettings() {
    const wrap = el('div');
    const f1 = field('Apps Script 웹앱 URL', 'url', state.config.gasUrl,
      '배포된 웹앱 주소(/exec). 저장하면 연결을 확인합니다. GAS 단독 배포(app.html)에서는 쓰지 않습니다.',
      null, 'https://script.google.com/macros/s/…/exec');
    const f2 = field('공유 토큰', 'text', state.config.token,
      'Code.gs의 TOKEN과 같아야 기록됩니다. 비워 두면 검사하지 않습니다.',
      null, 'Code.gs의 TOKEN 값');
    const f3 = field('보내는 사람 이름', 'text', state.config.author,
      '시트 작성자 열에 기록됩니다.', null, '라운');
    const f4 = field('자동 새로고침', 'select', String(state.config.pollSec), '', [
      ['0', '사용 안 함'], ['30', '30초마다'], ['60', '1분마다'], ['120', '2분마다'], ['300', '5분마다']
    ]);
    const demoRow = switchRow('데모 모드', '실제 시트 대신 내장 스냅숏을 봅니다.', !state.config.gasUrl ? true : state.config.demo, (on) => {
      if (!on && !state.config.gasUrl) { toast('먼저 Apps Script URL을 넣어 주세요.', true); return false; }
      saveConfig({ demo: on });
      applyMode();
      bootstrapData();
      return true;
    });
    if (window.SADAN_GAS_MODE) {
      const note = el('div', 'field help');
      note.textContent = 'Apps Script 단독 배포로 실행 중입니다 — 항상 실제 시트를 읽고, 보낸 지시는 바로 기록됩니다.';
      wrap.appendChild(note);
      [f2, f3, f4].forEach(n => wrap.appendChild(n));
    } else {
      [f1, f2, f3, f4, demoRow].forEach(n => wrap.appendChild(n));
    }

    const help = el('div', 'field');
    help.innerHTML = `<label>연결 방법</label>
      <div class="help">
        ① <code>gas/Code.gs</code>를 Apps Script 프로젝트에 붙여넣고 <b>웹앱으로 배포</b> → 나온 <code>/exec</code> 주소를 위에 입력.<br>
        ② 배포 설정: <b>다음 사용자로 실행 = 나</b>, <b>액세스 권한 = 모든 사용자</b>.<br>
        ③ 토큰을 쓰면 아무나 시트에 쓰는 것을 막을 수 있습니다(같은 값을 Code.gs TOKEN에).
      </div>`;
    wrap.appendChild(help);

    openModal({
      title: '설정',
      body: wrap,
      foot: [
        { label: '취소', cls: 'ghost', onClick: () => closeModal() },
        {
          label: '저장', onClick: async (btn) => {
            const gasUrl = f1.input.value.trim();
            const token = f2.input.value.trim();
            const author = f3.input.value.trim() || '라운';
            const pollSec = Number(f4.input.value);
            saveConfig({ gasUrl, token, author, pollSec, demo: gasUrl ? state.config.demo : true });
            btn.disabled = true; btn.textContent = '확인 중…';
            if (gasUrl) {
              try {
                await api.ping();
                saveConfig({ demo: false });
                setConn(true);
                toast('연결되었습니다.');
              } catch (e) {
                setConn(false);
                toast('연결하지 못했습니다: ' + e.message, true);
              }
            } else {
              setConn(true);
            }
            btn.textContent = '저장';
            closeModal();
            applyMode();
            await bootstrapData();
            // 샌드박스에서 첫 읽기가 일시적으로 실패하면 빈 화면이 남는다 → 한 번만 다시 시도.
            if (api.isLive() && !((state.rooms[state.roomId] || {}).msgs || []).length) {
              await new Promise(r => setTimeout(r, 700));
              await bootstrapData();
            }
          }
        }
      ]
    });
  }

  function field(label, type, value, help, options, placeholder) {
    const wrap = el('div', 'field');
    const lab = el('label', '', label);
    wrap.appendChild(lab);
    let input;
    if (type === 'select') {
      input = el('select');
      (options || []).forEach(([v, t]) => {
        const o = el('option', '', t);
        o.value = v;
        input.appendChild(o);
      });
      input.value = value;
    } else {
      input = el('input');
      input.type = type;
      input.value = value || '';
      input.placeholder = placeholder || '';
      if (type === 'url') input.autocomplete = 'url';
    }
    wrap.appendChild(input);
    if (help && type !== 'select') {
      const h = el('div', 'help', '');
      h.textContent = help;
      wrap.appendChild(h);
    }
    wrap.input = input;
    return wrap;
  }

  function switchRow(label, desc, on, onChange) {
    const row = el('div', 'switch-row');
    const left = el('div');
    left.appendChild(el('div', 'label', label));
    if (desc) left.appendChild(el('div', 'desc', desc));
    const sw = el('button', 'switch' + (on ? ' on' : ''));
    sw.type = 'button';
    sw.addEventListener('click', () => {
      const next = !sw.classList.contains('on');
      const ok = onChange(next);
      if (ok !== false) sw.classList.toggle('on', next);
    });
    row.appendChild(left);
    row.appendChild(sw);
    return row;
  }

  /* 시트·탭 선택 */
  async function openSheetPicker() {
    const wrap = el('div');
    const s = el('div', 'picker-search');
    const search = el('input');
    search.type = 'search';
    search.placeholder = '탭 이름 검색';
    s.appendChild(search);
    wrap.appendChild(s);
    const hint = el('div', 'help');
    hint.style.padding = '0 4px 6px';
    wrap.appendChild(hint);
    const listBox = el('div');
    wrap.appendChild(listBox);

    let all = [];
    const render = (q) => {
      listBox.innerHTML = '';
      q = (q || '').trim().toLowerCase();
      ['b', 'a'].forEach(sk => {
        const items = all.filter(t => t.sheet === sk && (!q || t.title.toLowerCase().includes(q)));
        if (!items.length) return;
        listBox.appendChild(el('div', 'picker-group', SHEETS[sk].name + (sk === 'a' ? ' (전체 ' + (state.tabsAll?.a?.length || items.length) + '탭)' : '')));
        items.slice(0, q ? 60 : 14).forEach(t => {
          const btn = el('button', 'picker-item' + (state.target.sheet === sk && state.target.tab === t.title ? ' sel' : ''));
          btn.type = 'button';
          btn.appendChild(el('span', 'name', t.title));
          if (t.lastRow) btn.appendChild(el('span', 'sub', t.lastRow + '행'));
          if (state.target.sheet === sk && state.target.tab === t.title) btn.appendChild(el('span', 'check', '✓'));
          btn.addEventListener('click', () => {
            saveTarget({ sheet: sk, tab: t.title });
            syncComposer();
            closeModal();
            toast(`${SHEETS[sk].short}사단 · ${t.title} 탭으로 설정`);
            refreshTargetKind();
          });
          listBox.appendChild(btn);
        });
      });
      if (!listBox.children.length) listBox.appendChild(el('div', 'empty', '탭을 찾지 못했습니다.'));
    };

    openModal({ title: '어디에 기록할까요?', body: wrap, foot: [{ label: '닫기', cls: 'ghost', onClick: closeModal }] });
    search.addEventListener('input', () => render(search.value));
    try {
      const b = await api.allTabs('b');
      const a = await api.allTabs('a');
      const mainOrder = t => {
        const i = A_MAIN_TABS.indexOf(t);
        return i < 0 ? 99 : i;
      };
      const aSorted = a.slice().sort((x, y) => mainOrder(x.title) - mainOrder(y.title));
      all = b.map(t => ({ sheet: 'b', title: t.title, lastRow: t.lastRow }))
        .concat(aSorted.map(t => ({ sheet: 'a', title: t.title, lastRow: t.lastRow })));
      if (a.length > 50) hint.textContent = `A사단은 탭이 ${a.length}개입니다. 위 검색창에 이름을 넣어 고르세요. (앞의 3개는 대화용 탭)`;
    } catch (e) {
      all = [];
    }
    render('');
    if (!all.length) hint.textContent = '';
  }

  /* 태그 선택 */
  function openTagPicker() {
    const wrap = el('div');
    const grid = el('div', 'tag-grid');
    const tags = tagsForTarget();
    tags.forEach(t => {
      const b = el('button', 'tag-opt' + (state.tag === t ? ' sel' : ''), t);
      b.type = 'button';
      b.addEventListener('click', () => {
        state.tag = t;
        syncComposer();
        closeModal();
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    const help = el('div', 'help', tagHelp());
    wrap.appendChild(help);
    // '태그 없음'을 고르면 안내 문구도 함께 바뀐다.
    grid.addEventListener('click', () => {
      help.textContent = tagHelp();
    });
    openModal({ title: '대상 대원 태그', body: wrap, foot: [{ label: '닫기', cls: 'ghost', onClick: closeModal }] });
  }

  function tagHelp() {
    if (inAiChat()) {
      const t = titleForTarget(state.tag).trim();
      return t ? '‘관련’(D열)에 이렇게 기록됩니다: ' + t
        : '‘관련’(D열)은 비워 두고 내용(C열)만 기록합니다.';
    }
    return '태그는 제목에 함께 기록됩니다: ' + titleForTarget(state.tag);
  }

  /* 방 메뉴 */
  function openRoomMenu() {
    const wrap = el('div');
    const room = roomById(state.roomId);

    wrap.appendChild(switchRow('자동 새로고침', `대원들이 올린 새 보고를 ${state.config.pollSec || 30}초마다 확인`, !!state.config.pollSec, (on) => {
      saveConfig({ pollSec: on ? 30 : 0 });
      schedulePoll();
      return true;
    }));

    const sec = el('div', 'field');
    sec.appendChild(el('label', '', '이 방의 탭'));
    const chips = el('div', 'tag-grid');
    const main = el('button', 'tag-opt' + (!state.tabFilter ? ' sel' : ''), '주요 탭 전체');
    main.type = 'button';
    main.addEventListener('click', async () => {
      state.tabFilter = null;
      closeModal();
      renderChatHead();
      await refresh({ silent: true });
      renderMessages();
    });
    chips.appendChild(main);
    room.sources.forEach(src => {
      src.tabs.forEach(tab => {
        const key = src.sheet + '|' + tab;
        const b = el('button', 'tag-opt' + (state.tabFilter === key ? ' sel' : ''), SHEETS[src.sheet].short + '·' + tab);
        b.type = 'button';
        b.addEventListener('click', async () => {
          state.tabFilter = key;
          closeModal();
          renderChatHead();
          toast(`${tab} 탭 기록만 봅니다.`);
          await refresh({ silent: true });
          renderMessages();
          scrollToBottom(true);
        });
        chips.appendChild(b);
      });
    });
    sec.appendChild(chips);
    wrap.appendChild(sec);

    const more = el('div', 'field');
    more.innerHTML = '<label>시트 원본</label>';
    room.sources.forEach(src => {
      const a = el('a', 'btn ghost small', SHEETS[src.sheet].name + ' 열기');
      a.href = 'https://docs.google.com/spreadsheets/d/' + SHEETS[src.sheet].id + '/edit';
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.cssText = 'display:inline-flex;align-items:center;margin:0 6px 6px 0;text-decoration:none';
      more.appendChild(a);
    });
    wrap.appendChild(more);

    const clear = el('button', 'btn danger', '이 방 읽음 표시 지우기');
    clear.type = 'button';
    clear.style.width = '100%';
    clear.addEventListener('click', () => {
      delete seen[room.id];
      saveSeen(seen);
      renderRooms();
      closeModal();
      toast('읽음 표시를 지웠습니다.');
    });
    wrap.appendChild(clear);

    openModal({ title: room.name + ' 설정', body: wrap, foot: [{ label: '닫기', cls: 'ghost', onClick: closeModal }] });
  }

  /* ───────── 모드 ───────── */
  function applyMode() {
    setConn(true);
    syncComposer();
  }

  /* ───────── 이벤트 ───────── */
  function bind() {
    $('#btnBack').addEventListener('click', () => {
      state.view = 'rooms';
      $('#app').dataset.view = 'rooms';
      syncOfficeVisible();
      renderRooms();
    });
    $('#btnRefresh').addEventListener('click', () => refresh({ manual: true }));
    $('#btnSearch').addEventListener('click', () => {
      state.searchOpen = !state.searchOpen;
      $('#searchBar').hidden = !state.searchOpen;
      if (state.searchOpen) $('#msgSearch').focus(); else { state.query = ''; $('#msgSearch').value = ''; renderMessages(); }
    });
    $('#btnSearchClose').addEventListener('click', () => {
      state.searchOpen = false;
      $('#searchBar').hidden = true;
      state.query = '';
      $('#msgSearch').value = '';
      renderMessages();
    });
    let searchT = null;
    $('#msgSearch').addEventListener('input', (e) => {
      clearTimeout(searchT);
      const v = e.target.value.trim();
      searchT = setTimeout(() => { state.query = v; renderMessages(); }, 120);
    });
    $('#btnMenu').addEventListener('click', openRoomMenu);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnModeToggle').addEventListener('click', openSettings);
    $('#btnTargetSheet').addEventListener('click', openSheetPicker);
    const tabFilterBtn = $('#btnTabFilter');
    if (tabFilterBtn) tabFilterBtn.addEventListener('click', openRoomMenu);
    $('#btnTargetTag').addEventListener('click', openTagPicker);
    $('#roomSearch').addEventListener('input', renderRooms);

    document.querySelectorAll('#filters .chip').forEach(c => {
      c.addEventListener('click', () => { state.filter = c.dataset.filter; renderMessages(); scrollToBottom(); });
    });

    $('#btnSend').addEventListener('click', send);
    const input = $('#input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });

    // 첨부(+): 메뉴 → 사진·동영상 / 파일
    $('#attachBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAttachMenu(); });
    const menu = $('#attachMenu');
    if (menu) {
      menu.addEventListener('click', (e) => { e.stopPropagation(); });
      menu.querySelectorAll('.attach-opt').forEach(opt => {
        opt.addEventListener('click', () => {
          const kind = opt.dataset.kind;
          closeAttachMenu();
          const inp = kind === 'media' ? $('#fileMedia') : $('#fileAny');
          if (!inp) return;
          inp.value = '';
          inp.click();
        });
      });
    }
    [['#fileMedia', addFiles], ['#fileAny', addFiles]].forEach(([sel, fn]) => {
      const inp = $(sel);
      if (!inp) return;
      inp.addEventListener('change', (e) => {
        fn(e.target.files);
        e.target.value = '';      // 같은 파일을 다시 골라도 보이도록
      });
    });
    document.addEventListener('click', (e) => {
      const m = $('#attachMenu');
      if (!m || m.hidden) return;
      if (!m.contains(e.target) && e.target !== $('#attachBtn')) closeAttachMenu();
    });
    // 첨부한 파일을 입력창 위로 끊어 놓기(PC)
    const chatBox = $('#chat');
    if (chatBox) {
      chatBox.addEventListener('dragover', (e) => { if (e.dataTransfer) e.preventDefault(); });
      chatBox.addEventListener('drop', (e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      });
    }

    $('#modalClose').addEventListener('click', closeModal);
    const ssb = $('#seatSheetBackdrop');
    if (ssb) {
      ssb.addEventListener('click', (e) => { if (e.target.id === 'seatSheetBackdrop') closeSeatSheet(); });
      $('#seatSheetClose').addEventListener('click', closeSeatSheet);
    }
    $('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = $('#attachMenu');
      if (m && !m.hidden) { closeAttachMenu(); return; }
      const ssb2 = $('#seatSheetBackdrop');
      if (ssb2 && !ssb2.hidden) { closeSeatSheet(); return; }
      if (!$('#modalBackdrop').hidden) closeModal();
    });

    const box = $('#messages');
    box.addEventListener('scroll', () => {
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      if (nearBottom) $('#jumpNew').hidden = true;
    });
    $('#jumpNew').addEventListener('click', () => { $('#jumpNew').hidden = true; scrollToBottom(true); });

    window.addEventListener('online', () => api.isLive() && refresh({ silent: true }));
    // 화면 폭이 바뀌면 워크플로우 캔버스를 다시 맞춘다(세로/가로 회전 포함).
    let wfResizeTimer = null;
    window.addEventListener('resize', () => {
      if (state.view !== 'workflow') return;
      clearTimeout(wfResizeTimer);
      wfResizeTimer = setTimeout(() => { wfFitView(); }, 160);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.view === 'chat' && api.isLive()) refresh({ silent: true });
    });
    window.addEventListener('sadan:config', () => { syncComposer(); schedulePoll(); });
  }

  /* ───────── 시작 ───────── */
  async function bootstrapData() {
    const box = $('#messages');
    const kind = roomById(state.roomId).kind;
    const panelRoom = kind === 'office' || kind === 'workflow';
    if (!state.rooms[state.roomId] && !panelRoom) {
      box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    }
    // 탭 메타(링크·선택기용)
    try { await api.tabs('b'); await api.tabs('a'); } catch (e) { console.warn('tabs', e); }
    for (const room of ROOMS) {
      try {
        if (room.id === state.roomId) continue;
        if (!state.rooms[room.id]) await loadRoom(room, { limit: 30 });
      } catch (e) { console.warn(room.id, e); }
    }
    try {
      await loadRoom(roomById(state.roomId), { limit: 80 });
    } catch (e) {
      console.error(e);
      toast(e.message || '불러오지 못했습니다.', true);
    }
    if (kind === 'office') renderOffice();
    else if (kind === 'workflow') renderWorkflow();
    else renderMessages();
    renderRooms();
    renderChatHead();
    markSeen(state.roomId);
    if (!panelRoom) scrollToBottom(true);
    applyMode();
    schedulePoll();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (window.top !== window.self) return; // Apps Script HTML 서비스(iframe)에서는 건너뜀
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btnInstall').hidden = false;
  });
  function bindInstall() {
    $('#btnInstall').addEventListener('click', async () => {
      if (!deferredPrompt) { toast('브라우저 메뉴에서 “홈 화면에 추가”를 눌러도 설치할 수 있어요.'); return; }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('#btnInstall').hidden = true;
    });
  }

  async function init() {
    try {
      const qs = new URLSearchParams(location.search);
      const rid = qs.get('room');
      if (rid && ROOMS.some(r => r.id === rid)) state.roomId = rid;
      if (qs.get('view') === 'chat') { state.view = 'chat'; }
    } catch (e) { /* ignore */ }
    // ?room=office·?room=workflow 로 바로 열면 채팅 대신 그 방 화면이 펼쳐진다.
    const startKind = roomById(state.roomId).kind;
    if (startKind === 'office') state.view = 'office';
    else if (startKind === 'workflow') state.view = 'workflow';
    // ?room=aichat 처럼 기본 전송 대상이 있는 방으로 바로 열렸을 때도 그 탭을 대상으로 잡는다.
    const startRoom = roomById(state.roomId);
    if (startRoom.target) saveTarget({ sheet: startRoom.target.sheet, tab: startRoom.target.tab });
    syncComposer();
    autoGrow();
    renderPending();
    renderRooms();
    refreshTargetKind();
    renderChatHead();
    bind();
    bindInstall();
    applyMode();
    if (state.view !== 'office' && state.view !== 'workflow' && window.matchMedia('(min-width: 900px)').matches) state.view = 'chat';
    $('#app').dataset.view = state.view;
    syncOfficeVisible();
    if (state.view === 'office') renderOffice();
    else if (state.view === 'workflow') renderWorkflow();
    bootstrapData();
    // 토큰이 없으면 빈 화면에 갇히므로 설정 창을 바로 열어 준다.
    if (window.SADAN_GAS_MODE && !state.config.token) {
      setTimeout(() => { if (!state.config.token) openSettings(); }, 900);
    }
    registerSW();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
