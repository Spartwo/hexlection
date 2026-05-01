// ── Google Sheets integration ──────────────────────────────────────────────────
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyqzq7L0IBrq38iEpG2r5u2Z7wJuIx0FlK11F7FFFtneGQqUoqQ_xo2AvjjL7CQfHlO/exec';

function getAppsScriptUrl() {
  return localStorage.getItem('appsScriptUrl') || DEFAULT_APPS_SCRIPT_URL;
}

async function fetchSheet(sheetName) {
  const url = `${getAppsScriptUrl()}?sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Sheet fetch failed: ' + sheetName);
  return res.json();
}

function cell(row, key) {
  if (!row || !key || row[key] === undefined || row[key] === null) return '';
  return String(row[key]).trim();
}

function parseNumberValue(value, fallback = 0) {
  const raw = String(value ?? '').replace(/,/g, '').replace(/%/g, '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseVoteShare(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = parseNumberValue(raw, 0);
  return raw.includes('%') ? n / 100 : n;
}

function findObjectKey(keys, patterns, fallbackIdx) {
  return keys.find(k => patterns.some(p => new RegExp(p, 'i').test(k.trim())))
    || keys[fallbackIdx];
}

async function loadFromSheet() {
  setStatus('loading sheet…');

  // Reset all stale state so highlights, selections and filters don't
  // bleed across data sources or reloads
  parlFilter         = null;
  window.PARL_FILTER = { tab: parlTab, value: null };
  window.HOVERED_HEX = null;
  selParty           = null;
  origColors         = null;
  window._territoryLoops = {};
  Object.keys(tState).forEach(k => delete tState[k]);
  render();

  try {
    const [electionRows, partyRows, zoneRows, groupsRaw] = await Promise.all([
      fetchSheet('Election'),
      fetchSheet('Parties'),
      fetchSheet('Zones'),
      fetchSheet('Groups'),
    ]);

    // ── 1. Image URL from Election!B2 ─────────────────────────────────────────
    if (!electionRows.length) { setStatus('Election sheet empty', true); return; }
    let imageUrl = '';
    for (const val of Object.values(electionRows[0])) {
      const text = String(val ?? '').trim();
      if (text.startsWith('http')) { imageUrl = text; break; }
    }
    if (!imageUrl) { setStatus('no image URL found in Election sheet', true); return; }

    const electionKeys = Object.keys(electionRows[0]);
    const arcKey  = findObjectKey(electionKeys, ['arc'], 2);
    const rowsKey = findObjectKey(electionKeys, ['rows'], 3);
    const tailKey = findObjectKey(electionKeys, ['tail'], 4);
    window.ELECTION_CONFIG = {
      arcAngle: parseNumberValue(electionRows[0][arcKey], 360),
      rows:     parseNumberValue(electionRows[0][rowsKey], 4),
      tailPct:  Math.max(0, Math.min(1, parseVoteShare(electionRows[0][tailKey])))
    };

    // ── 2. Parties from Parties! ──────────────────────────────────────────────
    if (!partyRows.length) { setStatus('Parties sheet empty', true); return; }
    PARTIES = partyRows.map((row, i) => {
      const keys = Object.keys(row);
      const nameKey    = keys.find(k => /party|name/i.test(k))        || keys[0];
      const shortKey   = keys.find(k => /short|abbr|abbrev/i.test(k)) || keys[1];
      const summaryKey = keys.find(k => /summary|desc/i.test(k));
      const hexKey     = keys.find(k => /hex|colour|color/i.test(k));
      const nationKey  = keys.find(k => /nation|country/i.test(k));
      const intlKey    = keys.find(k => k.trim() === 'International Group') || keys.find(k => /intl|international/i.test(k));

      const name    = cell(row, nameKey);
      const short   = cell(row, shortKey);
      const summary = summaryKey ? cell(row, summaryKey) : '';
      const rawHex  = hexKey ? cell(row, hexKey).replace(/^#/, '') : '';
      const nation  = nationKey ? cell(row, nationKey) : '';
      const intlGrp = intlKey  ? cell(row, intlKey) : '';
      const color   = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex : '#888888';
      return { id: 'p' + i, name, short, summary, color, nation, intlGrp };
    }).filter(p => p.name);

    const partyByShort = {};
    PARTIES.forEach(p => { if (p.short) partyByShort[p.short] = p; });

    // ── 3. Zones from Zones! ──────────────────────────────────────────────────
    if (!zoneRows.length) { setStatus('Zones sheet empty', true); return; }

    const zoneKeys = Object.keys(zoneRows[0]);
    const findKey = (patterns, fallbackIdx) => findObjectKey(zoneKeys, patterns, fallbackIdx);

    const regionKey  = findKey(['region','zone'],        0);
    const nameKey    = findKey(['province','name'],      1);
    const seatsKey   = findKey(['seats'],                4);
    const hexKey     = findKey(['hex','colour','color'], 5);
    const turnoutKey = findKey(['turnout'],              6);

    const FIXED_KEYS = new Set(
      [regionKey, nameKey, seatsKey, hexKey, turnoutKey,
       findKey(['pop'],2), findKey(['appor'],3)]
      .filter(Boolean).map(k => k.trim())
    );

    const voteKeys = zoneKeys.filter(k => !FIXED_KEYS.has(k.trim()));

    window.ZONES = zoneRows.map((row, i) => {
      const region  = cell(row, regionKey);
      const name    = cell(row, nameKey);
      const seats   = Math.max(0, Math.floor(parseNumberValue(row[seatsKey], 1))) || 1;
      const rawHex  = cell(row, hexKey).replace(/^#/, '');
      const color   = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex.toLowerCase() : null;
      const turnout = parseVoteShare(row[turnoutKey]);

      const votes = {};
      let winner = null, winPct = 0;
      voteKeys.forEach(k => {
        const short = k.trim();
        const pct = parseVoteShare(row[k]);
        votes[short] = pct;
        if (pct > winPct) { winPct = pct; winner = short; }
      });

      return { id: 'z' + i, region, name, seats, color, votes, winner, winPct, turnout };
    }).filter(z => z.name);

    // ── 4a. ZONE_DISPLAY — party colour blended by margin strength ────────────
    const numParties = voteKeys.length || 1;
    const floor      = 1 / numParties;
    const ceil       = 0.70;

    window.ZONE_DISPLAY = {};
    window.ZONES.forEach(zone => {
      if (!zone.color) return;
      const party = zone.winner ? partyByShort[zone.winner] : null;
      if (!party) {
        window.ZONE_DISPLAY[zone.color] = { color: FILL_UNASSIGNED(), party: null, zone };
        return;
      }
      const strength = Math.max(0, Math.min(1, (zone.winPct - floor) / (ceil - floor)));
      window.ZONE_DISPLAY[zone.color] = { color: blendToWhite(party.color, strength), party, zone };
      tState[zone.color] = party.id;
    });

    // ── 4b. Groups sheet ──────────────────────────────────────────────────────
    window.GROUPS = {};
    if (groupsRaw && groupsRaw.length > 0) {
      const groupKeys = Object.keys(groupsRaw[0]);
      const groupNameKey  = findObjectKey(groupKeys, ['group|name'], 0);
      const groupShortKey = findObjectKey(groupKeys, ['short|abbr|abbrev'], 1);
      const groupHexKey   = findObjectKey(groupKeys, ['hex|colour|color'], 3);

      groupsRaw.forEach(row => {
        const key = cell(row, groupShortKey);
        if (!key) return;
        const name   = cell(row, groupNameKey) || key;
        const rawHex = cell(row, groupHexKey).replace(/^#/, '');
        const color  = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex : '#888888';
        window.GROUPS[key] = { name, color };
      });
    }

    // ── 4c. ZONE_DISPLAY_INTL ─────────────────────────────────────────────────
    window.ZONE_DISPLAY_INTL = {};
    window.ZONES.forEach(zone => {
      if (!zone.color) return;
      const party = zone.winner ? partyByShort[zone.winner] : null;
      const group = party && party.intlGrp ? (window.GROUPS || {})[party.intlGrp] : null;
      if (!party) {
        window.ZONE_DISPLAY_INTL[zone.color] = { color: FILL_UNASSIGNED(), party: null, zone };
        return;
      }
      const strength = Math.max(0, Math.min(1, (zone.winPct - floor) / (ceil - floor)));
      window.ZONE_DISPLAY_INTL[zone.color] = {
        color: blendToWhite(group ? group.color : party.color, strength),
        party, zone
      };
    });

    // ── 5. Boot UI ────────────────────────────────────────────────────────────
    buildPartyBar();
    selParty = PARTIES[0] ? PARTIES[0].id : null;
    buildSeats();
    renderResults();
    buildParlLegend();
    renderParliament();
    render(); // paint zone colours now that ZONE_DISPLAY is ready

    // ── 6. Load map image from URL in Election sheet ─────────────────────────
    setStatus('loading image…');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => processImage(img);
    img.onerror = () => setStatus('image load failed', true);
    img.src = imageUrl;

  } catch(err) {
    setStatus('error: ' + err.message, true);
    console.error(err);
  }
}
