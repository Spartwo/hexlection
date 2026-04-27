// ── Google Sheets integration ──────────────────────────────────────────────────
const SHEET_ID = '1Sf_FElbmBA7-JCL9s0MB5wVRW-Gz4TviA5K_QJwPXDU';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyqzq7L0IBrq38iEpG2r5u2Z7wJuIx0FlK11F7FFFtneGQqUoqQ_xo2AvjjL7CQfHlO/exec';

async function fetchSheet(sheetName) {
  const url = `${APPS_SCRIPT_URL}?sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Sheet fetch failed: ' + sheetName);
  return res.json();
}

async function loadFromSheet() {
  setStatus('loading sheet…');
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
      if ((val || '').trim().startsWith('http')) { imageUrl = val.trim(); break; }
    }
    if (!imageUrl) { setStatus('no image URL found in Election sheet', true); return; }

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

      const name    = (row[nameKey]    || '').trim();
      const short   = (row[shortKey]   || '').trim();
      const summary = summaryKey ? (row[summaryKey] || '').trim() : '';
      const rawHex  = hexKey ? (row[hexKey] || '').trim().replace(/^#/, '') : '';
      const nation  = nationKey ? (row[nationKey] || '').trim() : '';
      const intlGrp = intlKey  ? (row[intlKey]   || '').trim() : '';
      const color   = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex : '#888888';
      return { id: 'p' + i, name, short, summary, color, nation, intlGrp };
    }).filter(p => p.name);

    const partyByShort = {};
    PARTIES.forEach(p => { if (p.short) partyByShort[p.short] = p; });

    // ── 3. Zones from Zones! ──────────────────────────────────────────────────
    if (!zoneRows.length) { setStatus('Zones sheet empty', true); return; }

    const zoneKeys = Object.keys(zoneRows[0]);
    const findKey = (patterns, fallbackIdx) =>
      zoneKeys.find(k => patterns.some(p => new RegExp(p, 'i').test(k.trim())))
      || zoneKeys[fallbackIdx];

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
      const region  = (row[regionKey] || '').trim();
      const name    = (row[nameKey]   || '').trim();
      const seats   = parseInt((row[seatsKey] || '1').replace(/,/g, '')) || 1;
      const rawHex  = (row[hexKey]    || '').trim().replace(/^#/, '');
      const color   = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex.toLowerCase() : null;
      const turnout = parseFloat((row[turnoutKey] || '0').replace(/%/g, '')) || 0;

      const votes = {};
      let winner = null, winPct = 0;
      voteKeys.forEach(k => {
        const short = k.trim();
        const raw = (row[k] || '0').trim();
        const hasPercent = raw.includes('%');
        const pct = (parseFloat(raw.replace(/%/g,'')) || 0) / (hasPercent ? 100 : 1);
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
        window.ZONE_DISPLAY[zone.color] = { color: FILL_UNASSIGNED, party: null, zone };
        return;
      }
      const strength = Math.max(0, Math.min(1, (zone.winPct - floor) / (ceil - floor)));
      window.ZONE_DISPLAY[zone.color] = { color: blendToWhite(party.color, strength), party, zone };
      tState[zone.color] = party.id;
    });

    // ── 4b. Groups sheet ──────────────────────────────────────────────────────
    window.GROUPS = {};
    if (groupsRaw && groupsRaw.length > 0) {
      const nameRow  = groupsRaw[0];
      const colorRow = groupsRaw[4];
      if (nameRow) {
        Object.keys(nameRow).forEach(short => {
          if (!short || short.trim() === '') return;
          const name   = (nameRow[short] || short).trim();
          const rawHex = colorRow ? (colorRow[short] || '').trim().replace(/^#/, '') : '';
          const color  = /^[0-9a-fA-F]{6}$/.test(rawHex) ? '#' + rawHex : '#888888';
          window.GROUPS[short.trim()] = { name, color };
        });
      }
    }

    // ── 4c. ZONE_DISPLAY_INTL ─────────────────────────────────────────────────
    window.ZONE_DISPLAY_INTL = {};
    window.ZONES.forEach(zone => {
      if (!zone.color) return;
      const party = zone.winner ? partyByShort[zone.winner] : null;
      const group = party && party.intlGrp ? (window.GROUPS || {})[party.intlGrp] : null;
      if (!party) {
        window.ZONE_DISPLAY_INTL[zone.color] = { color: FILL_UNASSIGNED, party: null, zone };
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
    renderResults();
    buildSeats();
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
