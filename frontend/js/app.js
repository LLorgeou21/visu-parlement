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

async function ouvrirDetailScrutin(numero) {
  const modal = document.getElementById("fond-modal");
  const contenu = document.getElementById("contenu-modal");
  contenu.innerHTML = "<p>Chargement...</p>";
  modal.classList.remove("masque");

  try {
    const detail = await chargerJSON(`data/actuality/scrutins/${numero}.json`);
    const lignesGroupes = [...detail.parGroupe]
      .sort((a, b) => (b.pour + b.contre + b.abstentions) - (a.pour + a.contre + a.abstentions))
      .map((g) => `
        <div class="ligne-groupe-vote">
          ${badgeGroupe(g.groupe)}
          ${barreVotes(g.pour, g.contre, g.abstentions)}
          <span>${g.pour}-${g.contre}-${g.abstentions}</span>
        </div>`)
      .join("");

    contenu.innerHTML = `
      <span class="badge-resultat ${classeResultat(detail.resultat)}">${detail.resultat}</span>
      <h2>${detail.titre}</h2>
      <p class="detail-chiffres">
        ${formaterDate(detail.date)} · ${detail.typeVote}${detail.dossier ? ` · ${detail.dossier}` : ""}
      </p>
      <div class="detail-chiffres">
        ${detail.votants} votants · ${detail.pour} pour · ${detail.contre} contre · ${detail.abstentions} abstentions
      </div>
      ${lignesGroupes}`;
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
  return `
    <article class="carte-depute">
      <div class="carte-depute-nom">${nomComplet(depute)}</div>
      ${badgeGroupe(depute.groupe)}
      <div class="carte-depute-lieu">${lieu}</div>
    </article>`;
}

function filtrerEtAfficherDeputes() {
  const recherche = document.getElementById("recherche-depute").value.trim().toLowerCase();
  const groupeChoisi = document.getElementById("filtre-groupe").value;

  const resultats = [...deputesParId.values()].filter((depute) => {
    const correspondNom = nomComplet(depute).toLowerCase().includes(recherche);
    const correspondGroupe = !groupeChoisi || depute.groupe === groupeChoisi;
    return correspondNom && correspondGroupe;
  });

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

function ordonnerGroupesParPosition(deputes) {
  const placesParGroupe = new Map();
  for (const d of deputes) {
    if (!placesParGroupe.has(d.groupe)) placesParGroupe.set(d.groupe, []);
    placesParGroupe.get(d.groupe).push(d.placeHemicycle);
  }
  return [...placesParGroupe.entries()]
    .sort((a, b) => mediane(a[1]) - mediane(b[1]))
    .map(([groupeId]) => groupeId);
}

function calculerPositionsHemicycle(deputes, ordreGroupes) {
  // Chaque groupe politique doit occuper un secteur angulaire d'un seul tenant, étalé sur
  // toutes les rangées (du premier au dernier rang) — pas une rangée entière par groupe, et
  // pas non plus un petit groupe "englouti" dans la plage de numéros d'un plus grand groupe
  // voisin. On trie donc d'abord les députés par groupe (dans l'ordre gauche-droite déduit de
  // la médiane des vrais numéros de place de chaque groupe), puis par numéro de place à
  // l'intérieur du groupe. Les emplacements (rangée x angle) sont calculés séparément puis
  // triés par angle, et distribués dans cet ordre.
  const rangGroupe = new Map(ordreGroupes.map((id, i) => [id, i]));
  const tries = [...deputes].sort((a, b) => {
    const diff = rangGroupe.get(a.groupe) - rangGroupe.get(b.groupe);
    return diff !== 0 ? diff : a.placeHemicycle - b.placeHemicycle;
  });
  const total = tries.length;

  const NB_RANGEES = 10;
  const RAYON_MIN = 90;
  const RAYON_MAX = 300;
  const ANGLE_MIN = (165 * Math.PI) / 180;
  const ANGLE_MAX = (15 * Math.PI) / 180;

  const rayons = Array.from({ length: NB_RANGEES }, (_, i) => RAYON_MIN + ((RAYON_MAX - RAYON_MIN) * i) / (NB_RANGEES - 1));
  const poidsTotal = rayons.reduce((s, r) => s + r, 0);
  const tailles = rayons.map((r) => Math.round((total * r) / poidsTotal));
  tailles[tailles.length - 1] += total - tailles.reduce((s, n) => s + n, 0);

  const emplacements = [];
  tailles.forEach((taille, i) => {
    const rayon = rayons[i];
    for (let j = 0; j < taille; j++) {
      const t = taille === 1 ? 0.5 : j / (taille - 1);
      const angle = ANGLE_MIN + (ANGLE_MAX - ANGLE_MIN) * t;
      emplacements.push({ angle, x: 300 + rayon * Math.cos(angle), y: 320 - rayon * Math.sin(angle) });
    }
  });
  emplacements.sort((a, b) => b.angle - a.angle);

  return tries.map((depute, i) => ({ depute, x: emplacements[i].x, y: emplacements[i].y }));
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

function afficherHemicycle() {
  const deputesAvecPlace = [...deputesParId.values()].filter((d) => d.placeHemicycle && d.groupe);
  const ordreGroupes = ordonnerGroupesParPosition(deputesAvecPlace);
  const positions = calculerPositionsHemicycle(deputesAvecPlace, ordreGroupes);
  const cercles = positions
    .map(({ depute, x, y }) => {
      const groupe = groupesParId.get(depute.groupe);
      const couleur = groupe ? groupe.couleur : "#8d949a";
      const etiquette = `${nomComplet(depute)} (${groupe ? groupe.abrev : "NI"})`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${couleur}"><title>${etiquette}</title></circle>`;
    })
    .join("");

  document.getElementById("hemicycle").innerHTML = `
    <svg viewBox="0 0 600 340" role="img" aria-label="Hémicycle de l'Assemblée nationale">${cercles}</svg>
    <div class="legende-hemicycle">${legendeHemicycle(ordreGroupes)}</div>
    <p class="hemicycle-note">
      Disposition approximative reconstituée à partir des numéros de place réels
      (les coordonnées exactes des sièges ne sont pas publiées en open data). Les groupes sont
      ordonnés selon la médiane de leurs numéros de place réels, de gauche à droite.
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

  const [groupes, deputes, index] = await Promise.all([
    chargerJSON("data/permanent/groupes.json"),
    chargerJSON("data/permanent/deputes.json"),
    chargerJSON("data/actuality/scrutins_index.json"),
  ]);

  groupesParId = new Map(groupes.map((g) => [g.id, g]));
  deputesParId = new Map(deputes.map((d) => [d.id, d]));
  scrutinsIndex = index;
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

  document.body.addEventListener("click", (e) => {
    const carte = e.target.closest(".carte-scrutin");
    if (carte) ouvrirDetailScrutin(carte.dataset.numero);
  });

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
