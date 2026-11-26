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
    pendingNew: 0
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
      top.appendChild(el('span', 'room-count', ofc ? ofc.counts.total + '명' : `${msgs.length}건`));
      top.appendChild(el('span', 'room-time', last ? fmtRoomTime(last.ts) : ''));
      body.appendChild(top);

      const prev = el('div', 'room-preview');
      if (ofc) {
        prev.appendChild(el('span', '', '열일 ' + ofc.counts.working + ' · 활동 ' + ofc.counts.active + ' · 대기 ' + ofc.counts.idle));
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
    state.view = room.kind === 'office' ? 'office' : 'chat';
    $('#app').dataset.view = state.view;
    syncOfficeVisible();
    renderRooms();
    renderChatHead();
    if (state.view === 'office') renderOffice();
    else renderMessages();
    markSeen(id);
    if (state.view !== 'office') scrollToBottom(true);
    if (api.isLive()) refresh({ silent: true });
  }

  function renderChatHead() {
    const room = roomById(state.roomId);
    $('#chatName').textContent = room.name;
    const tabs = state.tabFilter ? state.tabFilter.split('|')[1] : null;
    if (room.kind === 'office') {
      const s = state.officeSnap;
      $('#chatSub').textContent = s
        ? s.counts.total + '명 · 열일 ' + s.counts.working + ' · 활동 ' + s.counts.active + ' · 대기 ' + s.counts.idle
        : room.desc;
      $('#tabFilterLabel').textContent = '근무 현황';
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

  /* ───────── 오피스 (사단 2D 오피스) ───────── */
  // 근무 상태 기준 — 마지막 시트 기록이 30분 이내면 '열일중', 2시간 이내면 '작업함', 그 밖/기록 없음은 '대기'.
  const OFC_WORK_MS = 30 * 60e3;
  const OFC_ACTIVE_MS = 120 * 60e3;

  // 고정 명단. 여기에 없는 이름이 시트에 나타나면 buildOfficeRoster()가 자리를 새로 만든다.
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

  const OFC_ZONE_NAME = { a: 'A사단 존', b: 'B사단 존', n: '새로 합류' };

  function officeHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
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
  // 'Muse (A사단장)'·'Muse' → A-Muse, 'Muse-B'·'Muse (B사단장)' → B-Muse,
  // '피클 (A사단)' → 피클, '뀨-B (Cue)' → 뀨-B 처럼 괄호 표기를 걷어내고 사단을 읽는다.
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

  // 탭 이름이 '사람 탭'처럼 보이는지 — 124개 작업 탭(예: '겨울꿀템 20', 'Instinct 능력')을
  // 대원으로 잘못 세우지 않도록, 공백·숫자가 없고 라틴 문자가 들어간 짧은 이름만 인정한다.
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
    return 'idle';
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
    // 기록이 아직 없는 탭 이름은 '새로 합류' 구역에 모아 둔다 — 진짜 사단원 자리를 적지 않게.
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

    const rank = { working: 0, active: 1, idle: 2 };
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

    const counts = { total: all.length - 1, working: 0, active: 0, idle: 0 };
    all.forEach(p => { if (p.id !== 'ceo') counts[p.status]++; });
    return { all, zones, leads, counts, now, ceo: zones.ceo[0] || null };
  }

  function officeMsgs() {
    const data = state.rooms[state.roomId];
    return data ? data.msgs : [];
  }

  function officeBadge(p, status) {
    if (p.id === 'ceo') return '👑 사장실';
    if (status === 'working') return '🔥 열일중';
    if (status === 'active') return '💻 작업함';
    return p.last ? '☕ 대기' : '💤 휴식';
  }
  function officeStatusText(p, status) {
    if (p.id === 'ceo') return '👑 사장실 (사단 전체를 보고 있음)';
    if (status === 'working') return '🔥 열일중 (30분 안에 기록)';
    if (status === 'active') return '💻 작업함 (2시간 안에 기록)';
    return p.last ? '☕ 대기 (2시간 넘게 조용함)' : '💤 휴식 (기록 없음)';
  }

  // 귀여운 미니 캐릭터 — 머리·표정·몸체. 상태에 따라 눈·입이 달라진다.
  function officeCharSvg(color, status) {
    const hair = shade(color, -34);
    const eye = status === 'idle'
      ? '<path d="M24.6 25.4q2.4-2.2 4.8 0M34.6 25.4q2.4-2.2 4.8 0" fill="none" stroke="#3B2A20" stroke-width="1.7" stroke-linecap="round"/>'
      : '<circle cx="27" cy="25" r="1.9" fill="#3B2A20"/><circle cx="37" cy="25" r="1.9" fill="#3B2A20"/>';
    const mouth = status === 'working'
      ? '<ellipse cx="32" cy="31.4" rx="2.7" ry="2.1" fill="#8C4A3C"/>'
      : '<path d="M28.6 30.8q3.4 2.6 6.8 0" fill="none" stroke="#3B2A20" stroke-width="1.6" stroke-linecap="round"/>';
    return '<svg class="seat-char" viewBox="0 0 64 70" aria-hidden="true">' +
      '<ellipse cx="32" cy="66" rx="15" ry="3.2" fill="rgba(24,32,48,.12)"/>' +
      '<rect x="20" y="37" width="24" height="26" rx="11" fill="' + color + '"/>' +
      '<rect x="26.5" y="52" width="11" height="9" rx="4.5" fill="rgba(255,255,255,.38)"/>' +
      '<circle cx="32" cy="25" r="15" fill="#FFE3C8"/>' +
      '<path d="M17.4 24.2a14.6 14.6 0 0 1 29.2 0c0 3.6-4.4 2.4-8.6 1.8-2.8-.4-5.4-.4-8.2 0-4.4.8-12.4 1.4-12.4-1.8z" fill="' + hair + '"/>' +
      eye + mouth +
      '<circle cx="23.4" cy="30.6" r="2.6" fill="#FFB3A7" opacity=".8"/>' +
      '<circle cx="40.6" cy="30.6" r="2.6" fill="#FFB3A7" opacity=".8"/>' +
      '</svg>';
  }

  function officeSeatEl(p, opts) {
    opts = opts || {};
    const b = el('button', 'seat st-' + p.status + (opts.lead ? ' lead' : '') + (opts.ceo ? ' ceo' : '') + (p.dyn ? ' dyn' : ''));
    b.type = 'button';
    b.dataset.mid = p.id;
    b.dataset.status = p.status;
    b.title = p.name + ' · ' + p.role;
    b.appendChild(el('span', 'seat-badge', officeBadge(p, p.status)));

    const stage = el('span', 'seat-stage');
    const mon = el('span', 'seat-mon');
    mon.appendChild(el('i', 'scr'));
    stage.appendChild(mon);
    if (opts.lead) {
      const mon2 = el('span', 'seat-mon second');
      mon2.appendChild(el('i', 'scr'));
      stage.appendChild(mon2);
    }
    const wrap = el('span', 'seat-char-wrap');
    wrap.innerHTML = officeCharSvg(p.color || '#5B4BD6', p.status);
    stage.appendChild(wrap);
    stage.appendChild(el('span', 'seat-pin', p.emoji || '🙂'));
    b.appendChild(stage);

    const desk = el('span', 'seat-desk');
    if (p.status === 'working') desk.appendChild(el('span', 'seat-paper', '📄'));
    if (opts.lead) desk.appendChild(el('span', 'seat-tray', '🗂️'));
    b.appendChild(desk);

    const plate = el('span', 'seat-plate');
    plate.appendChild(el('b', '', p.name));
    plate.appendChild(el('i', '', p.role));
    b.appendChild(plate);

    b.addEventListener('click', () => openSeatSheet(p));
    return b;
  }

  function officeZoneEl(key, list, summary) {
    const z = el('section', 'ofc-zone z-' + key);
    const head = el('header', 'ofc-zone-head');
    head.appendChild(el('span', 'zone-dot'));
    head.appendChild(el('h3', '', OFC_ZONE_NAME[key] || '대원석'));
    const w = list.filter(p => p.status === 'working').length;
    head.appendChild(el('span', 'zone-count', list.length + '명' + (w ? ' · 열일 ' + w : '')));
    z.appendChild(head);
    const grid = el('div', 'ofc-seats');
    list.forEach(p => grid.appendChild(officeSeatEl(p)));
    z.appendChild(grid);
    return z;
  }

  function officeCeoRoom(snap) {
    const ceo = snap.ceo || OFFICE_FIXED[0];
    const sec = el('section', 'ofc-ceo');
    const rug = el('div', 'ceo-rug');
    sec.appendChild(rug);

    const seat = officeSeatEl(ceo, { ceo: true });
    seat.classList.add('seat-ceo');
    const room = el('div', 'ceo-room');
    room.appendChild(seat);
    room.appendChild(el('span', 'ceo-plant', '🪴'));
    sec.appendChild(room);

    const board = el('button', 'ceo-board');
    board.type = 'button';
    board.title = '사단 요약 보기';
    board.appendChild(el('div', 'ceo-board-title', '📋 사단 현황'));
    const stats = el('div', 'ceo-stats');
    const mk = (cls, n, label) => {
      const s = el('span', 'ceo-stat ' + cls);
      s.appendChild(el('b', '', String(n)));
      s.appendChild(el('i', '', label));
      return s;
    };
    stats.appendChild(mk('total', snap.counts.total, '대원'));
    stats.appendChild(mk('working', snap.counts.working, '열일'));
    stats.appendChild(mk('active', snap.counts.active, '활동'));
    stats.appendChild(mk('idle', snap.counts.idle, '대기'));
    board.appendChild(stats);

    const news = el('ul', 'ceo-news');
    const latest = snap.all.filter(p => p.id !== 'ceo' && p.last).sort((a, b) => b.last.ts - a.last.ts).slice(0, 3);
    if (!latest.length) news.appendChild(el('li', 'none', '아직 올라온 기록이 없습니다.'));
    latest.forEach(p => {
      const li = el('li');
      li.appendChild(el('span', 'cn-emoji', p.emoji || '🙂'));
      const tx = el('span', 'cn-tx');
      tx.appendChild(el('b', '', p.name));
      tx.appendChild(el('span', '', (p.last.title || p.last.body || '').slice(0, 26)));
      li.appendChild(tx);
      li.appendChild(el('span', 'cn-time', officeAgo(p.last.ts)));
      news.appendChild(li);
    });
    board.appendChild(news);
    board.addEventListener('click', () => openSeatSheet(ceo));
    sec.appendChild(board);
    return sec;
  }

  function officeLeadsRoom(snap) {
    const sec = el('section', 'ofc-leads');
    const head = el('header', 'ofc-zone-head');
    head.appendChild(el('span', 'zone-dot'));
    head.appendChild(el('h3', '', '팀장실'));
    head.appendChild(el('span', 'zone-count', snap.leads.length + '석'));
    sec.appendChild(head);
    const grid = el('div', 'ofc-seats leads');
    snap.leads.forEach(p => grid.appendChild(officeSeatEl(p, { lead: true })));
    sec.appendChild(grid);
    sec.appendChild(el('div', 'ofc-leads-note', 'A·B사단을 지휘하는 사단장석 — 자리마다 지난 기록으로 상태를 보여줍니다'));
    return sec;
  }

  function renderOffice() {
    const box = $('#office');
    if (!box) return;
    box.hidden = false;
    const snap = officeSnapshot(officeMsgs());
    state.officeSnap = snap;
    box.innerHTML = '';
    const floor = el('div', 'ofc-floor');
    floor.appendChild(officeCeoRoom(snap));
    floor.appendChild(officeLeadsRoom(snap));
    ['a', 'b', 'n'].forEach(k => {
      if (snap.zones[k] && snap.zones[k].length) floor.appendChild(officeZoneEl(k, snap.zones[k], snap.counts));
    });
    const foot = el('div', 'ofc-foot');
    foot.textContent = '시트에 남은 마지막 기록으로 근무 상태를 계산합니다 · 30분 안 = 🔥 열일중 / 2시간 안 = 💻 작업함 / 그 밖 = ☕ 대기';
    floor.appendChild(foot);
    box.appendChild(floor);

    const sub = $('#chatSub');
    if (sub) sub.textContent = snap.counts.total + '명 · 열일 ' + snap.counts.working + ' · 활동 ' + snap.counts.active + ' · 대기 ' + snap.counts.idle;
    const lbl = $('#tabFilterLabel');
    if (lbl) lbl.textContent = '근무 현황';
  }

  function openSeatSheet(p) {
    const snap = state.officeSnap || officeSnapshot(officeMsgs());
    const body = $('#seatSheetBody');
    if (!body) return;
    body.innerHTML = '';

    const head = el('div', 'ss-head');
    const av = el('div', 'ss-av', p.emoji || '🙂');
    av.style.background = p.color || '#5B4BD6';
    head.appendChild(av);
    const titles = el('div', 'ss-titles');
    const nm = el('b', '', p.name);
    nm.id = 'seatSheetName';
    titles.appendChild(nm);
    titles.appendChild(el('span', '', p.role));
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
      stats.appendChild(mk('idle', snap.counts.idle, '대기 중'));
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
      p.recent.slice(0, 2).forEach(m => {
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

  // 오피스 패널은 [hidden] 으로도 감춰지므로 뷰에 맞춰 직접 켜고 끈다.
  function syncOfficeVisible() {
    const box = $('#office');
    if (box) box.hidden = state.view !== 'office';
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
      const box = $('#messages');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
      if (isOffice) renderOffice();
      else renderMessages();
      renderRooms();
      if (added.length && !opts.silent) {
        toast(`${added.length}건 새 기록을 불러왔습니다.`);
        if (!isOffice) scrollToBottom(true);
      } else if (added.length && opts.silent) {
        if (isOffice) { /* 오피스는 자동 갱신만 */ }
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
      if (state.view !== 'chat' && state.view !== 'office') return;
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
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.view === 'chat' && api.isLive()) refresh({ silent: true });
    });
    window.addEventListener('sadan:config', () => { syncComposer(); schedulePoll(); });
  }

  /* ───────── 시작 ───────── */
  async function bootstrapData() {
    const box = $('#messages');
    const officeRoom = roomById(state.roomId).kind === 'office';
    if (!state.rooms[state.roomId] && !officeRoom) {
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
    if (officeRoom) renderOffice();
    else renderMessages();
    renderRooms();
    renderChatHead();
    markSeen(state.roomId);
    if (!officeRoom) scrollToBottom(true);
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
    // ?room=office 로 바로 열면 채팅 대신 오피스 화면이 펼쳐진다.
    if (roomById(state.roomId).kind === 'office') state.view = 'office';
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
    if (state.view !== 'office' && window.matchMedia('(min-width: 900px)').matches) state.view = 'chat';
    $('#app').dataset.view = state.view;
    syncOfficeVisible();
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
