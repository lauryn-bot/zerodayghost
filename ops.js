/* =====================================================================
   ops.js : la couche militaire « Opération Kriegspiel »
   - fonctions pures, aucun accès à la page (testables avec Node : test_ops.js)
   - brouillard de guerre (couverture de détection) pour les échecs
   - phases de la Cyber Kill Chain pour les dames
   - classement de chaque ordre selon une tactique MITRE D3FEND
   - compte rendu d'incident de fin de partie
   ===================================================================== */

const Ops = (() => {
  /* ---------------- Référentiels ---------------- */

  // Les 7 tactiques de MITRE D3FEND (https://d3fend.mitre.org)
  const TACTICS = {
    model: { fr: 'Modéliser', en: 'Model' },
    harden: { fr: 'Durcir', en: 'Harden' },
    detect: { fr: 'Détecter', en: 'Detect' },
    isolate: { fr: 'Isoler', en: 'Isolate' },
    deceive: { fr: 'Leurrer', en: 'Deceive' },
    evict: { fr: 'Évincer', en: 'Evict' },
    restore: { fr: 'Restaurer', en: 'Restore' },
  };
  const TACTIC_ORDER = ['model', 'harden', 'detect', 'isolate', 'deceive', 'evict', 'restore'];

  // Les 7 phases de la Cyber Kill Chain (Lockheed Martin, 2011)
  const PHASES = ['Reconnaissance', 'Armement', 'Livraison', 'Exploitation', 'Installation', 'Commande et contrôle', 'Actions sur objectifs'];

  // Ordre de bataille : rôle de chaque pièce d'échecs (1 pion … 6 roi)
  const ROLES = {
    blue: { 1: 'Poste sentinelle', 2: 'Groupe d’intervention', 3: 'Sonde de détection', 4: 'Pare-feu', 5: 'CALID', 6: 'Poste de commandement' },
    red: { 1: 'Maliciel', 2: 'Mouvement latéral', 3: 'Implant furtif', 4: 'Canal d’exfiltration', 5: 'APT', 6: 'Serveur C2' },
  };
  const role = (team, t) => ROLES[team][t] || '?';

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  /* ---------------- Échecs : brouillard de guerre ---------------- */
  // Plateau 0x88 (comme engines.js) : 128 cases, s & 0x88 != 0 = hors plateau.
  const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  const B_OFF = [15, 17, -15, -17];
  const R_OFF = [1, -1, 16, -16];
  const K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
  const on = s => s >= 0 && s < 128 && !(s & 0x88);

  // Couverture de détection d'un camp : ses propres cases, toutes les cases où ses pièces
  // peuvent aller (jusqu'au premier obstacle, obstacle compris) et les diagonales de ses pions.
  function chessCoverage(b, side) {
    const cov = new Set();
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const x = b[s];
      if (!x || (x > 0) !== (side > 0)) continue;
      cov.add(s);
      const t = Math.abs(x);
      if (t === 1) {
        const dir = 16 * side, start = side === 1 ? 1 : 6;
        const f1 = s + dir;
        if (on(f1)) {
          cov.add(f1);
          if (!b[f1] && (s >> 4) === start && on(f1 + dir)) cov.add(f1 + dir);
        }
        for (const d of [dir - 1, dir + 1]) if (on(s + d)) cov.add(s + d);
      } else if (t === 2 || t === 6) {
        for (const o of t === 2 ? N_OFF : K_OFF) if (on(s + o)) cov.add(s + o);
      } else {
        const offs = t === 3 ? B_OFF : t === 4 ? R_OFF : K_OFF;
        for (const o of offs) {
          let to = s + o;
          while (on(to)) { cov.add(to); if (b[to]) break; to += o; }
        }
      }
    }
    return cov;
  }

  // Cases occupées par l'adversaire et visibles pour `side`
  function visibleEnemies(b, side, cov) {
    cov = cov || chessCoverage(b, side);
    const out = new Set();
    for (const s of cov) if (b[s] && (b[s] > 0) !== (side > 0)) out.add(s);
    return out;
  }

  // Ordre de la Blue Team aux échecs -> tactique D3FEND + texte du journal
  function chessBlueEvent(o) {
    let tactic, text;
    if (o.mate) {
      tactic = 'evict';
      text = `Éviction : serveur C2 adverse neutralisé (échec et mat) · ${o.role} en ${o.to}`;
    } else if (o.victimRole) {
      tactic = 'evict';
      text = `Éviction : ${o.victimRole} adverse en ${o.to}, par votre ${o.role}`;
      if (o.promoRole) text += ` (promu ${o.promoRole})`;
      if (o.check) text += ' · serveur C2 adverse sous pression';
    } else if (o.check) {
      tactic = 'isolate';
      text = `Isolement : le serveur C2 adverse est sous pression (échec) · ${o.role} en ${o.to}`;
    } else if (o.promoRole) {
      tactic = 'restore';
      text = `Restauration : capacité rétablie, nouveau ${o.promoRole} en ${o.to}`;
    } else if (o.castle) {
      tactic = 'harden';
      text = 'Durcissement : poste de commandement mis à l’abri (roque)';
    } else if (o.revealed > 0) {
      tactic = 'detect';
      text = `Détection : ${plural(o.revealed, 'menace repérée', 'menaces repérées')} après le redéploiement de votre ${o.role} en ${o.to}`;
    } else {
      tactic = 'harden';
      text = `Durcissement : redéploiement de votre ${o.role} en ${o.to}`;
    }
    return { team: 'blue', tactic, text };
  }

  // Coup de la Red Team aux échecs, vu par la Blue Team (seulement ce que l'arbitre annonce)
  function chessRedEvent(o) {
    let text, alert = false;
    const detected = !!(o.visibleTo || o.victimRole);
    if (o.mate) {
      alert = true;
      text = 'COMPROMISSION : poste de commandement neutralisé (échec et mat)';
      text += o.visibleTo ? ` · auteur : ${o.role} adverse en ${o.to}` : ' · origine hors couverture';
    } else if (o.victimRole) {
      alert = true;
      text = `Neutralisation de votre ${o.victimRole} en ${o.to}`;
      text += o.visibleTo ? ` · auteur : ${o.role} adverse` : ' · origine hors couverture';
      if (o.check) text += ' · poste de commandement menacé (échec)';
    } else if (o.check) {
      alert = true;
      text = 'ALERTE : poste de commandement menacé (échec)';
      text += o.visibleTo ? ` · ${o.role} adverse en ${o.to}` : ' · origine hors couverture';
    } else if (o.visibleTo && o.promoRole) {
      alert = true;
      text = `Escalade : ${o.promoRole} adverse apparu en ${o.to}`;
    } else if (o.visibleTo) {
      text = `Contact : ${o.role} adverse ` + (o.visibleFrom ? `${o.from} → ${o.to}` : `en ${o.to}`);
    } else {
      text = 'Activité adverse hors couverture';
    }
    return { team: 'red', alert, detected, text };
  }

  /* ---------------- Dames : Cyber Kill Chain ---------------- */
  // Phase (0 à 6) d'une rangée du damier (0 = en haut), vue depuis l'attaquant.
  // red = -1 : l'attaquant a les Noirs (rangées 0 à 3 au départ) et descend ;
  // red = 1 : l'attaquant a les Blancs (rangées 6 à 9) et monte.
  // Ses 4 rangées de départ = Reconnaissance, puis une phase par rangée jusqu'à la promotion.
  function killChainPhase(row, red) {
    const d = red === -1 ? row : 9 - row;
    return d <= 3 ? 0 : d - 3;
  }

  // Niveau de menace : phase la plus avancée parmi les pièces de l'attaquant (une dame = phase 7)
  function threatLevel(b, red) {
    let t = -1;
    for (let i = 0; i < 100; i++) {
      const x = b[i];
      if (!x || (x > 0) !== (red > 0)) continue;
      const ph = Math.abs(x) === 2 ? 6 : killChainPhase((i / 10) | 0, red);
      if (ph > t) t = ph;
    }
    return t;
  }

  // La pièce bleue arrivée en `to` se place-t-elle juste devant un pion de l'attaquant ?
  function damesBlocks(b, to, red) {
    const fwd = red === 1 ? -1 : 1;           // sens de marche des pions de l'attaquant
    const r = ((to / 10) | 0) - fwd, c = to % 10; // rangée d'où ils viendraient
    if (r < 0 || r > 9) return false;
    for (const dc of [-1, 1]) {
      const cc = c + dc;
      if (cc >= 0 && cc < 10 && b[r * 10 + cc] === red) return true; // pion (pas dame) de l'attaquant
    }
    return false;
  }

  function damesBlueEvent(o) {
    let tactic, text;
    if (o.caps > 0) {
      tactic = 'evict';
      text = `Éviction : ${o.caps > 1 ? `${o.caps} implants neutralisés` : 'un implant neutralisé'} (${o.nota})`;
      if (o.capsKing) text += ', dont une APT persistante';
      if (o.promo) text += ' · groupe d’intervention déployé';
    } else if (o.promo) {
      tactic = 'restore';
      text = `Restauration : groupe d’intervention déployé (${o.nota})`;
    } else if (o.deceive) {
      tactic = 'deceive';
      text = `Leurre : appât en place (${o.nota}), l’attaquant est contraint de prendre`;
    } else if (o.isolate) {
      tactic = 'isolate';
      text = `Isolement : progression d’un implant bloquée (${o.nota})`;
    } else {
      tactic = 'harden';
      text = o.isKing ? `Durcissement : groupe d’intervention redéployé (${o.nota})` : `Durcissement : sentinelle repositionnée (${o.nota})`;
    }
    return { team: 'blue', tactic, text };
  }

  function damesRedEvent(o) {
    let text, alert = false;
    const prog = o.newThreat > o.prevThreat && o.newThreat >= 0;
    if (o.promo) {
      alert = true;
      text = `COMPROMISSION : un implant atteint «\u00A0${PHASES[6]}\u00A0» et devient une APT persistante (${o.nota})`;
    } else if (o.caps > 0) {
      alert = true;
      text = `Neutralisation ${o.caps > 1 ? `de ${o.caps} sentinelles` : 'd’une sentinelle'} (${o.nota})`;
      if (prog) text += ` · phase «\u00A0${PHASES[o.newThreat]}\u00A0» atteinte`;
    } else if (prog) {
      alert = true;
      text = `Progression : l’attaquant atteint la phase «\u00A0${PHASES[o.newThreat]}\u00A0» (${o.nota})`;
    } else if (o.isKing) {
      text = `APT persistante en mouvement (${o.nota})`;
    } else {
      text = `Mouvement adverse ${o.nota} · phase «\u00A0${PHASES[o.phase]}\u00A0»`;
    }
    return { team: 'red', alert, text };
  }

  /* ---------------- Compte rendu d'incident ---------------- */
  // r = { theatre, level, result, why, turns, summary: [lignes], tactics: {clé: n}, chronology: [{turn, team, tag, text}], date }
  function tacticsLine(tactics) {
    const parts = TACTIC_ORDER.filter(k => tactics[k]).map(k => `${TACTICS[k].fr} (${TACTICS[k].en}) ×${tactics[k]}`);
    return parts.length ? parts.join(', ') : 'aucune';
  }

  function reportText(r) {
    const L = [];
    L.push('COMPTE RENDU D’INCIDENT · OPÉRATION KRIEGSPIEL');
    L.push('='.repeat(47));
    L.push(`Théâtre           : ${r.theatre}`);
    L.push(`Date              : ${r.date}`);
    L.push(`Niveau de menace  : ${r.level}`);
    L.push(`Résultat          : ${r.result}`);
    L.push(`Motif             : ${r.why}`);
    L.push(`Durée             : ${plural(r.turns, 'tour', 'tours')}`);
    L.push('');
    L.push('SYNTHÈSE');
    for (const s of r.summary) L.push(`- ${s}`);
    L.push(`- Tactiques D3FEND employées : ${tacticsLine(r.tactics)}`);
    L.push('');
    L.push('CHRONOLOGIE');
    for (const e of r.chronology) {
      L.push(`T${String(e.turn).padEnd(3)} ${(e.team === 'blue' ? 'BLUE' : 'RED').padEnd(4)}  [${e.tag}] ${e.text}`);
    }
    L.push('');
    L.push('Simulation pédagogique. Référentiels : MITRE D3FEND (tactiques défensives),');
    L.push('Cyber Kill Chain de Lockheed Martin (phases d’une attaque), Kriegspiel (brouillard de guerre).');
    return L.join('\n');
  }

  return {
    TACTICS, TACTIC_ORDER, PHASES, ROLES, role,
    chessCoverage, visibleEnemies, chessBlueEvent, chessRedEvent,
    killChainPhase, threatLevel, damesBlocks, damesBlueEvent, damesRedEvent,
    tacticsLine, reportText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Ops;
