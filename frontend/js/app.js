const TAILLE_PAGE_SCRUTINS = 20;
const JOURS_SEMAINE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let groupesParId = new Map();
let deputesParId = new Map();
let scrutinsIndex = [];
let scrutinsAffiches = 0;
let scrutinsParJour = new Map();
let dossiersCalcules = [];
let votesParGroupeCache = null;
let moisCourant = new Date();
let hemicycleCoordonnees = new Map();
let participationDeputes = new Map();
let activiteDeputes = new Map();
let debutLegislature = null;

async function chargerJSON(chemin) {
  const reponse = await fetch(chemin);
  if (!reponse.ok) throw new Error(`Échec du chargement de ${chemin}`);
  return reponse.json();
}

function texteContraste(hex) {
  if (!hex) return "#000";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1c1f26" : "#ffffff";
}

function badgeGroupe(groupeId) {
  const groupe = groupesParId.get(groupeId);
  if (!groupe) return "";
  const couleur = groupe.couleur || "#8d949a";
  return `<span class="badge-groupe" style="background:${couleur};color:${texteContraste(couleur)}">${groupe.abrev}</span>`;
}

function formaterDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function classeResultat(code) {
  if (code === "adopté") return "adopte";
  if (code === "rejeté") return "rejete";
  return "autre";
}

function barreVotes(pour, contre, abstentions) {
  const total = pour + contre + abstentions || 1;
  return `
    <div class="barre-votes">
      <span class="barre-pour" style="width:${(pour / total) * 100}%"></span>
      <span class="barre-contre" style="width:${(contre / total) * 100}%"></span>
      <span class="barre-abstention" style="width:${(abstentions / total) * 100}%"></span>
    </div>`;
}

function carteScrutin(scrutin) {
  return `
    <article class="carte-scrutin" data-numero="${scrutin.numero}">
      <div class="carte-scrutin-entete">
        <span class="badge-resultat ${classeResultat(scrutin.resultat)}">${scrutin.resultat}</span>
        <span class="carte-scrutin-date">${formaterDate(scrutin.date)}</span>
      </div>
      <p class="carte-scrutin-titre">${scrutin.titre}</p>
      ${barreVotes(scrutin.pour, scrutin.contre, scrutin.abstentions)}
      <div class="carte-scrutin-chiffres">
        <span>${scrutin.pour} pour</span>
        <span>${scrutin.contre} contre</span>
        <span>${scrutin.abstentions} abstentions</span>
      </div>
    </article>`;
}

function afficherScrutinsSuivants() {
  const conteneur = document.getElementById("liste-scrutins");
  const suivants = scrutinsIndex.slice(scrutinsAffiches, scrutinsAffiches + TAILLE_PAGE_SCRUTINS);
  conteneur.insertAdjacentHTML("beforeend", suivants.map(carteScrutin).join(""));
  scrutinsAffiches += suivants.length;
  document.getElementById("charger-plus").style.display =
    scrutinsAffiches >= scrutinsIndex.length ? "none" : "block";
}

const COULEUR_POUR = "#2e8b57";
const COULEUR_CONTRE = "#c0392b";
const COULEUR_ABSTENTION = "#8d949a";
const COULEUR_ABSENT = "#d8dce2";

function hemicycleVotes(votesIndividuels) {
  const positionParDepute = new Map(votesIndividuels.map((v) => [v.depute, v.position]));

  const cercles = [...deputesParId.values()]
    .filter((depute) => depute.placeHemicycle && hemicycleCoordonnees.has(depute.placeHemicycle))
    .map((depute) => {
      const { x, y } = hemicycleCoordonnees.get(depute.placeHemicycle);
      const position = positionParDepute.get(depute.id);
      const couleur =
        position === "pour" ? COULEUR_POUR
        : position === "contre" ? COULEUR_CONTRE
        : position === "abstention" ? COULEUR_ABSTENTION
        : COULEUR_ABSENT;
      const etiquette = `${nomComplet(depute)} — ${position || "absent"}`;
      return `<circle cx="${x}" cy="${y}" r="6" fill="${couleur}" class="siege-depute" data-depute-id="${depute.id}"><title>${etiquette}</title></circle>`;
    })
    .join("");

  return `
    <div class="hemicycle">
      <svg viewBox="0 0 850 480" role="img" aria-label="Hémicycle du vote">${cercles}</svg>
      <div class="legende-hemicycle">
        <div class="legende-item"><span class="legende-pastille" style="background:${COULEUR_POUR}"></span>Pour</div>
        <div class="legende-item"><span class="legende-pastille" style="background:${COULEUR_CONTRE}"></span>Contre</div>
        <div class="legende-item"><span class="legende-pastille" style="background:${COULEUR_ABSTENTION}"></span>Abstention</div>
        <div class="legende-item"><span class="legende-pastille" style="background:${COULEUR_ABSENT}"></span>Absent</div>
      </div>
    </div>`;
}

let extraitsDebatsCache = null;

function extraitDebat(interventions) {
  if (!interventions || !interventions.length) return "";
  return `
    <h3>Contexte du débat (dernières interventions avant le vote)</h3>
    <div class="extraits-debat">
      ${interventions
        .map((i) => `<p class="extrait-debat"><span class="extrait-orateur">${i.orateur}</span> — ${i.texte}</p>`)
        .join("")}
    </div>`;
}

async function ouvrirDetailScrutin(numero) {
  const modal = document.getElementById("fond-modal");
  const contenu = document.getElementById("contenu-modal");
  contenu.innerHTML = "<p>Chargement...</p>";
  modal.classList.remove("masque");

  try {
    if (!extraitsDebatsCache) {
      extraitsDebatsCache = await chargerJSON("data/actuality/extraits_debats.json");
    }
    const detail = await chargerJSON(`data/actuality/scrutins/${numero}.json`);

    contenu.innerHTML = `
      <span class="badge-resultat ${classeResultat(detail.resultat)}">${detail.resultat}</span>
      <h2>${detail.titre}</h2>
      <p class="detail-chiffres">
        ${formaterDate(detail.date)} · ${detail.typeVote}${detail.dossier ? ` · ${detail.dossier}` : ""}
      </p>
      <div class="detail-chiffres">
        ${detail.votants} votants · ${detail.pour} pour · ${detail.contre} contre · ${detail.abstentions} abstentions
      </div>
      ${hemicycleVotes(detail.votesIndividuels)}
      ${extraitDebat(extraitsDebatsCache[numero])}`;
  } catch (erreur) {
    contenu.innerHTML = `<p>Détail indisponible pour ce scrutin (hors fenêtre conservée, ou erreur : ${erreur.message}).</p>`;
  }
}

function nomComplet(depute) {
  return `${depute.prenom} ${depute.nom}`;
}

function carteDepute(depute) {
  const lieu = [depute.departement, depute.numCirconscription ? `${depute.numCirconscription}e circ.` : null]
    .filter(Boolean)
    .join(" · ");
  const valeurAbsenteisme = absenteisme(depute);
  return `
    <article class="carte-depute" data-depute-id="${depute.id}">
      <div class="carte-depute-nom">${nomComplet(depute)}</div>
      ${badgeGroupe(depute.groupe)}
      <div class="carte-depute-lieu">${lieu}</div>
      ${valeurAbsenteisme !== null ? `<div class="carte-depute-absenteisme">${Math.round(valeurAbsenteisme * 100)}% d'absentéisme</div>` : ""}
    </article>`;
}

function barreParticipation(pourcentage) {
  return `
    <div class="barre-votes">
      <span class="barre-pour" style="width:${pourcentage}%"></span>
      <span class="barre-abstention" style="width:${100 - pourcentage}%"></span>
    </div>`;
}

function ouvrirFicheDepute(id) {
  const depute = deputesParId.get(id);
  if (!depute) return;

  const modal = document.getElementById("fond-modal");
  const contenu = document.getElementById("contenu-modal");
  const groupe = groupesParId.get(depute.groupe);
  const lieu = [depute.departement, depute.numCirconscription ? `${depute.numCirconscription}e circonscription` : null]
    .filter(Boolean)
    .join(" · ");

  const participation = participationDeputes.get(id);
  const tauxParticipation = participation ? Math.round((100 * participation.votes) / participation.totalScrutins) : null;

  const activite = activiteDeputes.get(id) || {
    amendementsAuteur: 0,
    amendementsCosignataire: 0,
    amendementsAdoptes: 0,
    questionsEcrites: 0,
  };

  // Les circonscriptions d'outre-mer et de l'étranger votent ~une semaine avant la
  // métropole : le tout premier cohorte de députés a donc des débutMandat étalés sur
  // quelques jours. Un seuil (30 jours) évite d'étiqueter à tort ces élus "d'origine"
  // comme des remplaçants.
  const SEUIL_NOUVEAU_JOURS = 30;
  const estRemplacant =
    depute.debutMandat &&
    debutLegislature &&
    (new Date(depute.debutMandat) - new Date(debutLegislature)) / 86400000 > SEUIL_NOUVEAU_JOURS;

  contenu.innerHTML = `
    ${badgeGroupe(depute.groupe)}
    <h2>${nomComplet(depute)}</h2>
    <p class="detail-chiffres">${groupe ? groupe.nom : ""}${lieu ? ` · ${lieu}` : ""}</p>
    <p class="detail-chiffres">
      ${depute.debutMandat ? `Député depuis le ${formaterDate(depute.debutMandat)}` : "Date d'entrée en fonction inconnue"}
      ${estRemplacant ? `<span class="badge-nouveau">remplaçant</span>` : ""}
      ${debutLegislature ? ` (législature depuis le ${formaterDate(debutLegislature)})` : ""}
    </p>

    <h3>Participation aux scrutins (depuis son entrée en fonction)</h3>
    ${tauxParticipation === null
      ? `<p class="compteur">Aucun scrutin trouvé pour ce député.</p>`
      : `${barreParticipation(tauxParticipation)}
         <p class="detail-chiffres">${tauxParticipation}% de participation (${participation.votes}/${participation.totalScrutins} scrutins) —
         absentéisme estimé ${100 - tauxParticipation}%</p>`}

    <h3>Activité législative (législature en cours)</h3>
    <p class="detail-chiffres">
      ${activite.amendementsAuteur} amendement(s) déposé(s) en tant qu'auteur
      (${activite.amendementsAdoptes} adopté(s)) · ${activite.amendementsCosignataire} cosigné(s)<br>
      ${activite.questionsEcrites} question(s) écrite(s) posée(s) au Gouvernement
    </p>`;

  modal.classList.remove("masque");
}

function filtrerEtAfficherDeputes() {
  const recherche = document.getElementById("recherche-depute").value.trim().toLowerCase();
  const groupeChoisi = document.getElementById("filtre-groupe").value;
  const tri = document.getElementById("tri-deputes").value;

  const resultats = [...deputesParId.values()].filter((depute) => {
    const correspondNom = nomComplet(depute).toLowerCase().includes(recherche);
    const correspondGroupe = !groupeChoisi || depute.groupe === groupeChoisi;
    return correspondNom && correspondGroupe;
  });

  if (tri === "absenteisme") {
    resultats.sort((a, b) => (absenteisme(b) ?? -1) - (absenteisme(a) ?? -1));
  } else {
    resultats.sort((a, b) => nomComplet(a).localeCompare(nomComplet(b)));
  }

  document.getElementById("compteur-deputes").textContent = `${resultats.length} député(s)`;
  document.getElementById("liste-deputes").innerHTML = resultats.map(carteDepute).join("");
}

function remplirSelectGroupes(id) {
  const select = document.getElementById(id);
  const groupesTries = [...groupesParId.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  select.insertAdjacentHTML(
    "beforeend",
    groupesTries.map((g) => `<option value="${g.id}">${g.nom}</option>`).join("")
  );
}

function initialiserOnglets() {
  document.querySelectorAll(".onglet-btn").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      document.querySelectorAll(".onglet-btn").forEach((b) => b.classList.remove("actif"));
      document.querySelectorAll(".panneau").forEach((p) => p.classList.remove("actif"));
      bouton.classList.add("actif");
      document.getElementById(`panneau-${bouton.dataset.onglet}`).classList.add("actif");
    });
  });
}

function initialiserSousOnglets() {
  document.querySelectorAll(".sous-onglets").forEach((nav) => {
    const conteneur = nav.parentElement;
    nav.querySelectorAll(".sous-onglet-btn").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        nav.querySelectorAll(".sous-onglet-btn").forEach((b) => b.classList.remove("actif"));
        conteneur.querySelectorAll(".sous-panneau").forEach((p) => p.classList.remove("actif"));
        bouton.classList.add("actif");
        document.getElementById(`sous-panneau-${bouton.dataset.sousOnglet}`).classList.add("actif");
      });
    });
  });
}

// --- Calendrier ---

function indexerScrutinsParJour() {
  scrutinsParJour = new Map();
  for (const s of scrutinsIndex) {
    if (!scrutinsParJour.has(s.date)) scrutinsParJour.set(s.date, []);
    scrutinsParJour.get(s.date).push(s);
  }
}

function afficherCalendrier() {
  const annee = moisCourant.getFullYear();
  const mois = moisCourant.getMonth();
  document.getElementById("calendrier-titre-mois").textContent = moisCourant.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const premierJour = new Date(annee, mois, 1);
  const decalage = (premierJour.getDay() + 6) % 7; // grille commençant un lundi
  const nbJours = new Date(annee, mois + 1, 0).getDate();

  const cellules = JOURS_SEMAINE.map((j) => `<div class="jour-entete">${j}</div>`);
  for (let i = 0; i < decalage; i++) cellules.push('<div class="jour-calendrier vide"></div>');
  for (let jour = 1; jour <= nbJours; jour++) {
    const iso = `${annee}-${String(mois + 1).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
    const scrutinsJour = scrutinsParJour.get(iso) || [];
    const classe = scrutinsJour.length ? "jour-calendrier actif-jour" : "jour-calendrier";
    cellules.push(`
      <button type="button" class="${classe}" data-jour="${iso}">
        <span>${jour}</span>
        ${scrutinsJour.length ? `<span class="pastille">${scrutinsJour.length}</span>` : ""}
      </button>`);
  }
  document.getElementById("grille-calendrier").innerHTML = cellules.join("");
}

function afficherScrutinsDuJour(iso) {
  const scrutins = scrutinsParJour.get(iso) || [];
  document.getElementById("liste-jour").innerHTML = scrutins.length
    ? scrutins.map(carteScrutin).join("")
    : `<p class="compteur">Aucun scrutin ce jour-là.</p>`;
}

// --- Par dossier ---

function grouperParDossier() {
  const groupes = new Map();
  for (const s of scrutinsIndex) {
    const cle = s.dossierRef || s.dossier || "__autres__";
    if (!groupes.has(cle)) {
      groupes.set(cle, { nom: s.dossier || "Autres (sans dossier législatif)", scrutins: [] });
    }
    groupes.get(cle).scrutins.push(s);
  }
  return [...groupes.values()];
}

function carteDossier(dossier, index) {
  const dernier = dossier.scrutins[0];
  return `
    <article class="carte-dossier" data-dossier-index="${index}">
      <div class="carte-scrutin-entete">
        <span class="badge-resultat ${classeResultat(dernier.resultat)}">${dernier.resultat}</span>
        <span class="carte-scrutin-date">${dossier.scrutins.length} scrutin(s) · ${formaterDate(dernier.date)}</span>
      </div>
      <p class="carte-scrutin-titre">${dossier.nom}</p>
    </article>
    <div class="sous-liste-dossier masque" id="sous-liste-dossier-${index}"></div>`;
}

function afficherDossiers() {
  dossiersCalcules = grouperParDossier();
  document.getElementById("liste-dossiers").innerHTML = dossiersCalcules
    .map((d, i) => carteDossier(d, i))
    .join("");
}

// --- Par groupe ---

function carteVoteGroupe(v) {
  return `
    <article class="carte-scrutin" data-numero="${v.numero}">
      <div class="carte-scrutin-entete">
        <span class="badge-position position-${v.position}">${v.position}</span>
        <span class="carte-scrutin-date">${formaterDate(v.date)}</span>
      </div>
      <p class="carte-scrutin-titre">${v.titre}</p>
      ${barreVotes(v.pour, v.contre, v.abstentions)}
    </article>`;
}

async function afficherVotesGroupe(groupeId) {
  const conteneur = document.getElementById("liste-votes-groupe");
  if (!groupeId) {
    conteneur.innerHTML = "";
    return;
  }
  conteneur.innerHTML = "<p>Chargement...</p>";
  if (!votesParGroupeCache) {
    votesParGroupeCache = await chargerJSON("data/actuality/votes_par_groupe.json");
  }
  const votes = votesParGroupeCache[groupeId] || [];
  conteneur.innerHTML = votes.length
    ? votes.map(carteVoteGroupe).join("")
    : `<p class="compteur">Aucun vote récent pour ce groupe.</p>`;
}

// --- Hémicycle ---

function mediane(nombres) {
  const tries = [...nombres].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2;
}

function ordonnerGroupesParPositionReelle(deputes) {
  const xParGroupe = new Map();
  for (const d of deputes) {
    const { x } = hemicycleCoordonnees.get(d.placeHemicycle);
    if (!xParGroupe.has(d.groupe)) xParGroupe.set(d.groupe, []);
    xParGroupe.get(d.groupe).push(x);
  }
  return [...xParGroupe.entries()]
    .sort((a, b) => mediane(a[1]) - mediane(b[1]))
    .map(([groupeId]) => groupeId);
}

function legendeHemicycle(ordreGroupes) {
  return ordreGroupes
    .map((id) => groupesParId.get(id))
    .filter(Boolean)
    .map((g) => `
      <div class="legende-item">
        <span class="legende-pastille" style="background:${g.couleur}"></span>
        ${g.abrev} — ${g.nom}
      </div>`)
    .join("");
}

function absenteisme(depute) {
  const participation = participationDeputes.get(depute.id);
  return participation ? 1 - participation.votes / participation.totalScrutins : null;
}

function echelleAbsenteisme(deputes) {
  const valeurs = deputes.map(absenteisme).filter((v) => v !== null);
  return { min: Math.min(...valeurs), max: Math.max(...valeurs) };
}

function rayonAbsenteisme(depute, echelle) {
  // Les sièges réels sont espacés de 13 à 21 unités (13 au plus serré) : au-delà
  // d'un rayon d'environ 6.5, deux voisins au maximum se chevaucheraient.
  const RAYON_MIN = 2;
  const RAYON_MAX = 6.5;
  const valeur = absenteisme(depute);
  if (valeur === null) return RAYON_MIN;
  const etendue = echelle.max - echelle.min || 1;
  const t = (valeur - echelle.min) / etendue;
  return RAYON_MIN + (RAYON_MAX - RAYON_MIN) * t;
}

function afficherHemicycle() {
  const deputesAvecSiege = [...deputesParId.values()].filter(
    (d) => d.placeHemicycle && d.groupe && hemicycleCoordonnees.has(d.placeHemicycle)
  );
  const tailleSelonAbsenteisme = document.getElementById("taille-absenteisme")?.checked;
  const echelle = tailleSelonAbsenteisme ? echelleAbsenteisme(deputesAvecSiege) : null;

  const cercles = deputesAvecSiege
    .map((depute) => {
      const { x, y } = hemicycleCoordonnees.get(depute.placeHemicycle);
      const groupe = groupesParId.get(depute.groupe);
      const couleur = groupe ? groupe.couleur : "#8d949a";
      const valeurAbsenteisme = absenteisme(depute);
      const etiquette = `${nomComplet(depute)} (${groupe ? groupe.abrev : "NI"})${
        tailleSelonAbsenteisme && valeurAbsenteisme !== null ? ` — ${Math.round(valeurAbsenteisme * 100)}% d'absentéisme` : ""
      }`;
      const rayon = tailleSelonAbsenteisme ? rayonAbsenteisme(depute, echelle).toFixed(1) : 6;
      return `<circle cx="${x}" cy="${y}" r="${rayon}" fill="${couleur}" class="siege-depute" data-depute-id="${depute.id}"><title>${etiquette}</title></circle>`;
    })
    .join("");

  const ordreGroupes = ordonnerGroupesParPositionReelle(deputesAvecSiege);

  document.getElementById("hemicycle").innerHTML = `
    <svg viewBox="0 0 850 480" role="img" aria-label="Hémicycle de l'Assemblée nationale">${cercles}</svg>
    <div class="legende-hemicycle">${legendeHemicycle(ordreGroupes)}</div>
    <p class="hemicycle-note">
      Disposition réelle des sièges, d'après le plan officiel de l'Assemblée nationale.
      ${tailleSelonAbsenteisme ? " Taille des sièges proportionnelle à l'absentéisme." : ""}
    </p>`;
}

function initialiserModal() {
  const fond = document.getElementById("fond-modal");
  document.getElementById("fermer-modal").addEventListener("click", () => fond.classList.add("masque"));
  fond.addEventListener("click", (e) => {
    if (e.target === fond) fond.classList.add("masque");
  });
}

async function afficherDerniereMaj() {
  try {
    const [metaPermanent, metaActuality] = await Promise.all([
      chargerJSON("data/permanent/meta.json"),
      chargerJSON("data/actuality/meta.json"),
    ]);
    const plusRecente = new Date(
      Math.max(new Date(metaPermanent.genereLe), new Date(metaActuality.genereLe))
    );
    document.getElementById("derniere-maj").textContent =
      `Données mises à jour le ${plusRecente.toLocaleString("fr-FR")}`;
  } catch {
    // pas bloquant si les fichiers meta n'existent pas encore
  }
}

async function main() {
  initialiserOnglets();
  initialiserSousOnglets();
  initialiserModal();
  afficherDerniereMaj();

  const [groupes, deputes, index, coordonnees, participation, activite] = await Promise.all([
    chargerJSON("data/permanent/groupes.json"),
    chargerJSON("data/permanent/deputes.json"),
    chargerJSON("data/actuality/scrutins_index.json"),
    chargerJSON("data/permanent/hemicycle_coordonnees.json"),
    chargerJSON("data/actuality/participation_deputes.json"),
    chargerJSON("data/actuality/activite_deputes.json"),
  ]);

  groupesParId = new Map(groupes.map((g) => [g.id, g]));
  deputesParId = new Map(deputes.map((d) => [d.id, d]));
  scrutinsIndex = index;
  hemicycleCoordonnees = new Map(coordonnees.sieges.map(([numero, x, y]) => [numero, { x, y }]));
  participationDeputes = new Map(Object.entries(participation));
  activiteDeputes = new Map(Object.entries(activite));
  debutLegislature = deputes
    .map((d) => d.debutMandat)
    .filter(Boolean)
    .sort()[0];
  moisCourant = index.length ? new Date(index[0].date) : new Date();

  remplirSelectGroupes("filtre-groupe");
  remplirSelectGroupes("selecteur-groupe-votes");
  filtrerEtAfficherDeputes();
  afficherScrutinsSuivants();
  indexerScrutinsParJour();
  afficherCalendrier();
  afficherDossiers();
  afficherHemicycle();

  document.getElementById("charger-plus").addEventListener("click", afficherScrutinsSuivants);
  document.getElementById("recherche-depute").addEventListener("input", filtrerEtAfficherDeputes);
  document.getElementById("filtre-groupe").addEventListener("change", filtrerEtAfficherDeputes);
  document.getElementById("tri-deputes").addEventListener("change", filtrerEtAfficherDeputes);

  document.body.addEventListener("click", (e) => {
    const carteScrutin = e.target.closest(".carte-scrutin");
    if (carteScrutin) ouvrirDetailScrutin(carteScrutin.dataset.numero);

    const carteDepute = e.target.closest(".carte-depute");
    if (carteDepute) ouvrirFicheDepute(carteDepute.dataset.deputeId);

    const siegeDepute = e.target.closest(".siege-depute");
    if (siegeDepute) ouvrirFicheDepute(siegeDepute.dataset.deputeId);
  });

  document.getElementById("taille-absenteisme").addEventListener("change", afficherHemicycle);

  document.getElementById("mois-precedent").addEventListener("click", () => {
    moisCourant.setMonth(moisCourant.getMonth() - 1);
    afficherCalendrier();
  });
  document.getElementById("mois-suivant").addEventListener("click", () => {
    moisCourant.setMonth(moisCourant.getMonth() + 1);
    afficherCalendrier();
  });
  document.getElementById("grille-calendrier").addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-jour]");
    if (bouton) afficherScrutinsDuJour(bouton.dataset.jour);
  });

  document.getElementById("liste-dossiers").addEventListener("click", (e) => {
    const carte = e.target.closest(".carte-dossier");
    if (!carte) return;
    const index = carte.dataset.dossierIndex;
    const sousListe = document.getElementById(`sous-liste-dossier-${index}`);
    if (sousListe.classList.contains("masque")) {
      sousListe.innerHTML = dossiersCalcules[index].scrutins.map(carteScrutin).join("");
      sousListe.classList.remove("masque");
    } else {
      sousListe.classList.add("masque");
      sousListe.innerHTML = "";
    }
  });

  document.getElementById("selecteur-groupe-votes").addEventListener("change", (e) => {
    afficherVotesGroupe(e.target.value);
  });
}

main();
