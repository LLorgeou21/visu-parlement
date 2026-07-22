const TAILLE_PAGE_SCRUTINS = 20;

let groupesParId = new Map();
let deputesParId = new Map();
let scrutinsIndex = [];
let scrutinsAffiches = 0;

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

function remplirFiltreGroupes() {
  const select = document.getElementById("filtre-groupe");
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

  remplirFiltreGroupes();
  filtrerEtAfficherDeputes();
  afficherScrutinsSuivants();

  document.getElementById("charger-plus").addEventListener("click", afficherScrutinsSuivants);
  document.getElementById("recherche-depute").addEventListener("input", filtrerEtAfficherDeputes);
  document.getElementById("filtre-groupe").addEventListener("change", filtrerEtAfficherDeputes);
  document.getElementById("liste-scrutins").addEventListener("click", (e) => {
    const carte = e.target.closest(".carte-scrutin");
    if (carte) ouvrirDetailScrutin(carte.dataset.numero);
  });
}

main();
