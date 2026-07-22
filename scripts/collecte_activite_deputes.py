"""Agrège l'activité législative des députés (amendements, questions écrites)
depuis data.assemblee-nationale.fr.

Ces jeux de données sont volumineux (amendements ~300 Mo) et évoluent lentement
par rapport aux scrutins : ce script est fait pour tourner moins souvent
(ex. une fois par jour) que collecte_scrutins.py.
"""
import io
import json
import zipfile
from pathlib import Path
from urllib.request import urlopen

URL_AMENDEMENTS = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip"
URL_QUESTIONS = "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip"
URL_DOSSIERS = "http://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"

TENTATIVES_TELECHARGEMENT = 5

ROOT = Path(__file__).resolve().parent.parent
OUT_ACTIVITE = ROOT / "data" / "actuality" / "activite_deputes.json"


def telecharger_zip(url: str) -> zipfile.ZipFile:
    # Ces archives sont volumineuses (jusqu'à ~300 Mo) : la connexion se coupe
    # parfois en cours de route, d'où les tentatives multiples.
    derniere_erreur = None
    for _ in range(TENTATIVES_TELECHARGEMENT):
        try:
            with urlopen(url) as reponse:
                return zipfile.ZipFile(io.BytesIO(reponse.read()))
        except Exception as erreur:  # noqa: BLE001
            derniere_erreur = erreur
    raise derniere_erreur


def compteur_depute() -> dict:
    return {
        "amendementsAuteur": 0,
        "amendementsCosignataire": 0,
        "amendementsAdoptes": 0,
        "questionsEcrites": 0,
        "propositionsLoi": 0,
    }


def extraire_ref(valeur) -> str | None:
    # Certains champs "nil" arrivent comme {"@xsi:nil": "true"} plutôt que null.
    if isinstance(valeur, dict):
        return valeur.get("#text")
    return valeur


def agreger_amendements(archive: zipfile.ZipFile, activite: dict[str, dict]) -> None:
    for nom in archive.namelist():
        if not nom.endswith(".json"):
            continue
        amendement = json.loads(archive.read(nom))["amendement"]
        signataires = amendement["signataires"]
        auteur_ref = extraire_ref(signataires["auteur"].get("acteurRef"))
        if not auteur_ref:
            continue  # amendement du gouvernement, pas d'un député

        fiche = activite.setdefault(auteur_ref, compteur_depute())
        fiche["amendementsAuteur"] += 1
        if amendement.get("cycleDeVie", {}).get("sort") == "Adopté":
            fiche["amendementsAdoptes"] += 1

        cosignataires = signataires.get("cosignataires") or {}
        refs = cosignataires.get("acteurRef") or []
        if isinstance(refs, str):
            refs = [refs]
        for ref in refs:
            ref = extraire_ref(ref)
            if ref:
                activite.setdefault(ref, compteur_depute())["amendementsCosignataire"] += 1


def agreger_questions(archive: zipfile.ZipFile, activite: dict[str, dict]) -> None:
    for nom in archive.namelist():
        if not nom.endswith(".json"):
            continue
        question = json.loads(archive.read(nom))["question"]
        auteur_ref = extraire_ref(question.get("auteur", {}).get("identite", {}).get("acteurRef"))
        if not auteur_ref:
            continue
        activite.setdefault(auteur_ref, compteur_depute())["questionsEcrites"] += 1


def agreger_propositions_loi(archive: zipfile.ZipFile, activite: dict[str, dict]) -> None:
    for nom in archive.namelist():
        if not nom.startswith("json/dossierParlementaire/") or not nom.endswith(".json"):
            continue
        dossier = json.loads(archive.read(nom))["dossierParlementaire"]
        if dossier.get("legislature") != "17":
            continue
        if "Proposition de loi" not in dossier["procedureParlementaire"]["libelle"]:
            continue

        initiateur = dossier.get("initiateur") or {}
        acteurs = (initiateur.get("acteurs") or {}).get("acteur")
        if not acteurs:
            continue
        if isinstance(acteurs, dict):
            acteurs = [acteurs]

        for acteur in acteurs:
            ref = extraire_ref(acteur.get("acteurRef"))
            if ref:
                activite.setdefault(ref, compteur_depute())["propositionsLoi"] += 1


def main() -> None:
    activite: dict[str, dict] = {}

    agreger_amendements(telecharger_zip(URL_AMENDEMENTS), activite)
    agreger_questions(telecharger_zip(URL_QUESTIONS), activite)
    agreger_propositions_loi(telecharger_zip(URL_DOSSIERS), activite)

    OUT_ACTIVITE.parent.mkdir(parents=True, exist_ok=True)
    OUT_ACTIVITE.write_text(json.dumps(activite, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Activité agrégée pour {len(activite)} députés.")


if __name__ == "__main__":
    main()
