"""Extrait le contexte réel du débat (dernières interventions avant le vote) pour
chaque scrutin récent, depuis les comptes rendus intégraux de séance.

Ce jeu de données est volumineux (~55 Mo) et évolue lentement : ce script est fait
pour tourner moins souvent (ex. une fois par jour) que collecte_scrutins.py, dont
il dépend (lit les fichiers déjà générés dans data/actuality/scrutins/).
"""
import io
import json
import re
import zipfile
from pathlib import Path
from urllib.request import urlopen
from xml.etree import ElementTree as ET

URL_DEBATS = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip"

NB_INTERVENTIONS = 6
TENTATIVES_TELECHARGEMENT = 5
NS = "{http://schemas.assemblee-nationale.fr/referentiel}"

ROOT = Path(__file__).resolve().parent.parent
IN_SCRUTINS_DIR = ROOT / "data" / "actuality" / "scrutins"
OUT_EXTRAITS = ROOT / "data" / "actuality" / "extraits_debats.json"


def telecharger_zip(url: str) -> zipfile.ZipFile:
    derniere_erreur = None
    for _ in range(TENTATIVES_TELECHARGEMENT):
        try:
            with urlopen(url) as reponse:
                return zipfile.ZipFile(io.BytesIO(reponse.read()))
        except Exception as erreur:  # noqa: BLE001
            derniere_erreur = erreur
    raise derniere_erreur


def charger_comptes_rendus(archive: zipfile.ZipFile) -> dict[str, ET.Element]:
    comptes_rendus = {}
    for nom in archive.namelist():
        if not nom.endswith(".xml"):
            continue
        racine = ET.fromstring(archive.read(nom))
        seance_ref = racine.findtext(f"{NS}seanceRef")
        if seance_ref:
            comptes_rendus[seance_ref] = racine
    return comptes_rendus


def texte_complet(element) -> str:
    return "".join(element.itertext()).strip()


def nom_orateur(paragraphe) -> str | None:
    orateur = paragraphe.find(f"{NS}orateurs/{NS}orateur/{NS}nom")
    return texte_complet(orateur) if orateur is not None else None


def trouver_paragraphe_resultat(paragraphes: list, votants_attendus: int):
    for i, para in enumerate(paragraphes):
        texte_elem = para.find(f"{NS}texte")
        if texte_elem is None:
            continue
        texte = texte_complet(texte_elem)
        if "Nombre de votants" not in texte:
            continue
        correspondance = re.search(r"Nombre de votants\D*(\d+)", texte)
        if correspondance and int(correspondance.group(1)) == votants_attendus:
            return i
    return None


def extraire_interventions(racine, votants_attendus: int) -> list[dict]:
    paragraphes = list(racine.iter(f"{NS}paragraphe"))
    index_resultat = trouver_paragraphe_resultat(paragraphes, votants_attendus)
    if index_resultat is None:
        return []

    interventions = []
    i = index_resultat - 1
    while i >= 0 and len(interventions) < NB_INTERVENTIONS:
        para = paragraphes[i]
        orateur = nom_orateur(para)
        texte_elem = para.find(f"{NS}texte")
        texte = texte_complet(texte_elem) if texte_elem is not None else ""
        if orateur and texte:
            interventions.append({"orateur": orateur, "texte": texte})
        i -= 1

    interventions.reverse()
    return interventions


def main() -> None:
    comptes_rendus = charger_comptes_rendus(telecharger_zip(URL_DEBATS))

    extraits: dict[str, list[dict]] = {}
    fichiers_scrutins = sorted(IN_SCRUTINS_DIR.glob("*.json"))
    for fichier in fichiers_scrutins:
        scrutin = json.loads(fichier.read_text(encoding="utf-8"))
        racine = comptes_rendus.get(scrutin.get("seanceRef"))
        if racine is None:
            continue
        interventions = extraire_interventions(racine, scrutin["votants"])
        if interventions:
            extraits[scrutin["numero"]] = interventions

    OUT_EXTRAITS.parent.mkdir(parents=True, exist_ok=True)
    OUT_EXTRAITS.write_text(json.dumps(extraits, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Extraits de débat trouvés pour {len(extraits)}/{len(fichiers_scrutins)} scrutins récents.")


if __name__ == "__main__":
    main()
