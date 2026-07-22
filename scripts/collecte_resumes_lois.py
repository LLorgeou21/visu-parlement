"""Extrait le résumé réel (exposé des motifs) des textes de loi déposés à
l'Assemblée nationale, pour les dossiers législatifs des scrutins récents.

Ne couvre que les textes déposés en premier à l'Assemblée (pas ceux dont le
premier dépôt a eu lieu au Sénat, dont l'exposé des motifs n'est pas sur ce
site). Nécessite pypdf (pip install pypdf) — seule dépendance externe des
scripts de collecte de ce projet, les textes de loi n'étant publiés qu'en PDF.
"""
import io
import json
import re
import zipfile
from pathlib import Path
from urllib.request import urlopen

import pypdf

URL_DOSSIERS = "http://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"
URL_TEXTE = "https://www.assemblee-nationale.fr/dyn/17/textes/l17b{numero}_{slug}.pdf"

TENTATIVES_TELECHARGEMENT = 5
LONGUEUR_CIBLE = 700  # caractères ; on étend jusqu'à la fin de la phrase en cours

SLUG_PAR_PROCEDURE = {
    "proposition": "proposition-loi",
    "projet": "projet-loi",
}

ROOT = Path(__file__).resolve().parent.parent
IN_SCRUTINS_DIR = ROOT / "data" / "actuality" / "scrutins"
OUT_RESUMES = ROOT / "data" / "actuality" / "resumes_lois.json"


def telecharger(url: str) -> bytes:
    derniere_erreur = None
    for _ in range(TENTATIVES_TELECHARGEMENT):
        try:
            with urlopen(url) as reponse:
                return reponse.read()
        except Exception as erreur:  # noqa: BLE001
            derniere_erreur = erreur
    raise derniere_erreur


def dossiers_refs_recents() -> set[str]:
    refs = set()
    for fichier in IN_SCRUTINS_DIR.glob("*.json"):
        scrutin = json.loads(fichier.read_text(encoding="utf-8"))
        if scrutin.get("dossierRef"):
            refs.add(scrutin["dossierRef"])
    return refs


def depot_initiative_an(acte) -> dict | None:
    if isinstance(acte, list):
        for a in acte:
            trouve = depot_initiative_an(a)
            if trouve:
                return trouve
        return None
    if not isinstance(acte, dict):
        return None
    if acte.get("@xsi:type") == "DepotInitiative_Type" and acte.get("codeActe") == "AN1-DEPOT":
        return acte
    sous_actes = acte.get("actesLegislatifs")
    if sous_actes:
        return depot_initiative_an(sous_actes.get("acteLegislatif"))
    return None


def url_texte(dossier: dict, depot: dict) -> str | None:
    procedure = dossier["procedureParlementaire"]["libelle"].lower()
    slug = next((v for cle, v in SLUG_PAR_PROCEDURE.items() if cle in procedure), None)
    if slug is None:
        return None
    correspondance = re.search(r"B(\d+)$", depot["texteAssocie"])
    if not correspondance:
        return None
    return URL_TEXTE.format(numero=correspondance.group(1), slug=slug)


def extraire_expose_des_motifs(pdf_bytes: bytes) -> str | None:
    lecteur = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    texte = "\n".join(page.extract_text() for page in lecteur.pages)

    debut_titre = texte.find("EXPOS")
    if debut_titre == -1:
        return None
    debut = texte.find("\n", debut_titre) + 1

    fin_match = re.search(r"\n\s*(PROPOSITION DE LOI|PROJET DE LOI)\s*\n", texte[debut:])
    corps = texte[debut : debut + fin_match.start()] if fin_match else texte[debut : debut + 2000]

    lignes = [
        ligne for ligne in corps.split("\n")
        if not re.fullmatch(r"\s*\W{0,3}\s*\d{1,4}\s*\W{0,3}\s*", ligne)
    ]
    corps_propre = re.sub(r"\s+", " ", " ".join(lignes)).strip()
    corps_propre = re.sub(r"^MESDAMES,\s*MESSIEURS\s*,?\s*", "", corps_propre, flags=re.IGNORECASE)
    if not corps_propre:
        return None

    if len(corps_propre) <= LONGUEUR_CIBLE:
        return corps_propre
    fin_phrase = corps_propre.find(". ", LONGUEUR_CIBLE)
    fin = fin_phrase + 1 if fin_phrase != -1 else LONGUEUR_CIBLE
    return corps_propre[:fin].strip()


def main() -> None:
    archive_dossiers = zipfile.ZipFile(io.BytesIO(telecharger(URL_DOSSIERS)))
    refs = dossiers_refs_recents()

    resumes: dict[str, str] = {}
    for ref in sorted(refs):
        try:
            dossier = json.loads(archive_dossiers.read(f"json/dossierParlementaire/{ref}.json"))
        except KeyError:
            continue
        dossier = dossier["dossierParlementaire"]

        depot = depot_initiative_an(dossier.get("actesLegislatifs", {}).get("acteLegislatif"))
        if not depot:
            continue
        url = url_texte(dossier, depot)
        if not url:
            continue

        try:
            resume = extraire_expose_des_motifs(telecharger(url))
        except Exception:  # noqa: BLE001
            continue
        if resume:
            resumes[ref] = resume

    OUT_RESUMES.parent.mkdir(parents=True, exist_ok=True)
    OUT_RESUMES.write_text(json.dumps(resumes, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Résumé trouvé pour {len(resumes)}/{len(refs)} dossiers récents.")


if __name__ == "__main__":
    main()
