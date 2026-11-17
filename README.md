# Opération Kriegspiel · Échecs & Dames de cyberdéfense

Site web d'une seule page qui transforme les échecs et les dames internationales (10×10) en **simulation de lutte informatique défensive (LID)**. Vous commandez la **Blue Team** (la défense) face à une **Red Team** jouée par une IA codée à la main, qui calcule dans le navigateur. On peut jouer en cliquant sur le plateau, ou taper l'ordre qu'on vient de jouer sur un vrai échiquier.

> Simulation pédagogique réalisée pour un portfolio. Sans lien avec le ministère des Armées.

## Les deux théâtres

### Échecs : « Brouillard de guerre »

Inspiré du **Kriegspiel**, la variante d'échecs où l'on ne voit pas les pièces adverses et où un arbitre annonce seulement certains événements.

- **Couverture de détection.** Vous ne voyez les pièces adverses que sur les cases que vos pièces surveillent : vos propres cases, toutes les cases où elles peuvent aller (jusqu'au premier obstacle) et les diagonales de vos pions. Le reste du plateau est hachuré.
- **L'attaquant voit tout** : il a terminé sa reconnaissance. Son IA joue donc avec un moteur d'échecs classique.
- **L'arbitre** annonce les neutralisations (avec la case, même hors couverture : une piste « ? » s'affiche), les menaces sur votre poste de commandement (échec) et refuse les ordres impossibles.
- **Victoire** : mat du serveur C2 adverse. Défaite : votre poste de commandement est maté.
- **Sur un échiquier réel** : ne posez que vos pièces bleues, comme au Kriegspiel. Quand l'arbitre annonce une neutralisation, retirez la pièce indiquée.

| Pièce | Blue Team (vous) | Red Team (l'attaquant) |
|---|---|---|
| Roi | Poste de commandement | Serveur C2 |
| Dame | CALID (centre d'analyse) | APT |
| Tour | Pare-feu | Canal d'exfiltration |
| Fou | Sonde de détection | Implant furtif |
| Cavalier | Groupe d'intervention | Mouvement latéral |
| Pion | Poste sentinelle | Maliciel |

### Dames : « Kill Chain »

Le damier suit les **7 phases de la Cyber Kill Chain** (Lockheed Martin), vues depuis l'attaquant : ses 4 rangées de départ correspondent à la reconnaissance, puis il reste exactement 6 rangées jusqu'à la promotion, une par phase (armement, livraison, exploitation, installation, commande et contrôle, actions sur objectifs). Les cases claires de chaque rangée sont teintées selon leur phase.

- Le **niveau d'alerte** affiche la phase la plus avancée atteinte par un implant.
- Un implant **promu en dame** = compromission : l'attaquant a atteint ses objectifs.
- Chaque **prise** casse un maillon. Comme la prise est obligatoire, un pion offert devient un **leurre** que l'attaquant doit prendre.
- **Victoire** : l'attaquant n'a plus aucun coup possible.

## Journal des opérations et compte rendu d'incident

Chacun de vos ordres est classé selon une tactique **MITRE D3FEND** (Modéliser, Durcir, Détecter, Isoler, Leurrer, Évincer, Restaurer) :

| Situation | Tactique D3FEND |
|---|---|
| Prise, mat du serveur C2 | Évincer (Evict) |
| Échec au serveur C2 (échecs), pion placé devant un implant (dames) | Isoler (Isolate) |
| Le coup révèle de nouvelles menaces (échecs) | Détecter (Detect) |
| Pion offert que l'attaquant est obligé de prendre (dames) | Leurrer (Deceive) |
| Promotion | Restaurer (Restore) |
| Roque, redéploiement | Durcir (Harden) |

Les coups de l'attaquant sont inscrits tels que la Blue Team les perçoit (« activité hors couverture », « contact », « alerte », « progression », « compromission »). À la fin de la partie, un **compte rendu d'incident** s'ouvre : résultat, durée, taux de mouvements adverses localisés (échecs) ou phase maximale atteinte (dames), pertes, tactiques employées et chronologie complète. Il se télécharge en `.txt`.

## Les fichiers

| Fichier | Langage | Rôle |
|---|---|---|
| `index.html` | HTML | Structure de la page : onglets, plateau, poste de commandement, journal, compte rendu |
| `style.css` | CSS | Apparence « salle d'opérations » : brouillard, teintes Kill Chain, couleurs Blue/Red, mobile |
| `engines.js` | JavaScript | Les moteurs : règles des deux jeux et IA (aucun accès à la page, peut tourner dans un Web Worker). **Inchangé** par la couche militaire |
| `ops.js` | JavaScript | La couche militaire : couverture de détection, phases Kill Chain, classement D3FEND, compte rendu (fonctions pures) |
| `ui.js` | JavaScript | L'interface : clics, saisie des ordres, brouillard, journal, appel de l'IA |
| `test_engines.js` | JavaScript (Node.js) | Tests automatiques des moteurs |
| `test_ops.js` | JavaScript (Node.js) | Tests automatiques de la couche militaire |
| `favicon.svg` | SVG | Icône de l'onglet |

`index.html` charge `style.css`, puis `engines.js`, `ops.js` et `ui.js` (l'ordre compte : `ui.js` utilise ce que définissent les deux autres).

## Lancer le site

**Option simple :** double-cliquer sur `index.html`. Tout fonctionne, mais Chrome refuse les Web Workers pour une page ouverte depuis le disque : l'IA calcule alors dans la page elle-même, qui peut se figer une ou deux secondes au niveau de menace « Élevée ».

**Option recommandée :** servir le dossier en local, puis ouvrir http://localhost:8000

```bash
cd echecs-dames
python3 -m http.server 8000
```

## Mettre le site en ligne (GitHub Pages, dans un sous-dossier du portfolio)

```bash
git clone https://github.com/<pseudo>/<depot-du-portfolio>.git
cd <depot-du-portfolio>
# copier le dossier echecs-dames/ ici
git add echecs-dames
git commit -m "Opération Kriegspiel : échecs et dames en mode cyberdéfense"
git push
```

Le jeu est alors accessible à l'adresse du portfolio suivie de `/echecs-dames/`. Les chemins sont relatifs, il fonctionne tel quel dans un sous-dossier. GitHub Pages n'envoie pas d'en-têtes HTTP personnalisés : la politique de sécurité (CSP) est donc dans une balise `<meta>` de `index.html`.

## Tester

```bash
node test_engines.js   # règles et IA : perft de référence, notation, mat, prise majoritaire…
node test_ops.js       # couche militaire : brouillard, phases, tactiques, compte rendu
```

- Perft échecs : https://www.chessprogramming.org/Perft_Results
- Perft dames : https://damforum.nl/viewtopic.php?p=64993
- `test_ops.js` vérifie notamment que **toute destination légale est dans la couverture de détection** : le brouillard ne peut pas être contourné par les coups proposés.

## Comment marche l'IA (`engines.js`)

1. **Génération des coups.** Échecs : plateau « 0x88 » (128 cases). Dames : 100 cases, numérotation officielle 1 à 50.
2. **Évaluation.** Matériel et bonus de placement.
3. **Recherche.** Minimax avec élagage alpha-bêta, approfondissement itératif, recherche de quiescence et tri des coups.
4. **Niveaux de menace.** « Faible » et « Modérée » cherchent moins profond et tirent au sort parmi les coups presque aussi bons. « Élevée » cherche aussi loin que possible en 2,5 s.

## Côté sécurité

- Aucun texte saisi n'est inséré comme HTML (`textContent` partout) et la saisie est limitée à 20 caractères.
- Politique de sécurité (CSP) stricte : scripts du site uniquement, aucune connexion sortante (`connect-src 'none'`). Les jauges sont dimensionnées via le CSSOM, autorisé par la CSP sans `unsafe-inline`.
- Les données envoyées au Worker sont revalidées (`aiCompute`).
- Le compte rendu est généré dans le navigateur et téléchargé localement : rien n'est envoyé.
- Seule requête externe : les polices Google Fonts. Pour un site 100 % hors ligne, supprimer ce lien : des polices système prennent le relais.

## Règles appliquées

- **Échecs** : règles FIDE (roque, prise en passant, promotion au choix). Nulle automatique : pat, triple répétition, 50 coups, matériel insuffisant.
- **Dames** : règles FMJD (damier de 100 cases, les Blancs commencent, prise obligatoire en avant comme en arrière, prise majoritaire, dame volante). Nulle : triple répétition, 25 coups de dames sans prise ni pion, fins de partie à 16 et 5 coups.

## Références

- MITRE D3FEND, tactiques défensives : https://d3fend.mitre.org/about
- Les 7 phases de la Cyber Kill Chain : https://www.eccouncil.org/cybersecurity-exchange/threat-intelligence/cyber-kill-chain-seven-steps-cyberattack
- Le Kriegspiel (variante d'échecs à information cachée) : https://cavac.at/cavacopedia/Kriegspiel%20%28chess%29
- Variante « Fog of War » (visibilité limitée aux cases atteignables) : https://patents.justia.com/patent/7410418
- Glossaire du COMCYBER (LID, CALID, SOC) : https://www.defense.gouv.fr/comcyber/quotidien-cybercombattants/glossaire-du-futur-cybercombattant-10-termes-connaitre-valider-vos-voeux
