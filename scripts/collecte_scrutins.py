"""Télécharge et transforme les données des scrutins depuis data.assemblee-nationale.fr.

Génère :
- data/actuality/scrutins_index.json : liste légère de tous les scrutins (pour une timeline)
- data/actuality/scrutins/<numero>.json : détail (par groupe + par député) des scrutins récents
"""
import io
import json
import zipfile
from datetime import date, timedelta
from pathlib import Path
from urllib.request import urlopen

URL_SCRUTINS = "http://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip"

JOURS_DETAIL = 90  # fenêtre glissante pour laquelle on garde le détail nominatif

ROOT = Path(__file__).resolve().parent.parent
OUT_INDEX = ROOT / "data" / "actuality" / "scrutins_index.json"
OUT_DETAIL_DIR = ROOT / "data" / "actuality" / "scrutins"


def telecharger_zip(url: str) -> zipfile.ZipFile:
    with urlopen(url) as reponse:
        return zipfile.ZipFile(io.BytesIO(reponse.read()))


def votants(bloc: dict | None) -> list[str]:
    if not bloc or not bloc.get("votant"):
        return []
    votant = bloc["votant"]
    if isinstance(votant, dict):
        votant = [votant]
    return [v["acteurRef"] for v in votant]


def resume_scrutin(scrutin: dict) -> dict:
    synthese = scrutin["syntheseVote"]
    decompte = synthese["decompte"]
    dossier = scrutin["objet"].get("dossierLegislatif") or {}
    return {
        "numero": scrutin["numero"],
        "date": scrutin["dateScrutin"],
        "titre": scrutin["titre"],
        "dossier": dossier.get("libelle"),
        "typeVote": scrutin["typeVote"]["libelleTypeVote"],
        "resultat": scrutin["sort"]["code"],
        "votants": int(synthese["nombreVotants"]),
        "pour": int(decompte["pour"]),
        "contre": int(decompte["contre"]),
        "abstentions": int(decompte["abstentions"]),
    }


def detail_scrutin(scrutin: dict, resume: dict) -> dict:
    groupes_brut = scrutin["ventilationVotes"]["organe"]["groupes"]["groupe"]
    if isinstance(groupes_brut, dict):
        groupes_brut = [groupes_brut]

    par_groupe = []
    votes_individuels = []
    for groupe in groupes_brut:
        vote = groupe["vote"]
        nominatif = vote["decompteNominatif"]
        par_groupe.append({
            "groupe": groupe["organeRef"],
            "position": vote["positionMajoritaire"],
            "pour": int(vote["decompteVoix"]["pour"]),
            "contre": int(vote["decompteVoix"]["contre"]),
            "abstentions": int(vote["decompteVoix"]["abstentions"]),
        })
        for position, acteurs in (
            ("pour", votants(nominatif.get("pours"))),
            ("contre", votants(nominatif.get("contres"))),
            ("abstention", votants(nominatif.get("abstentions"))),
        ):
            votes_individuels.extend({"depute": ref, "position": position} for ref in acteurs)

    return {**resume, "parGroupe": par_groupe, "votesIndividuels": votes_individuels}


def main() -> None:
    archive = telecharger_zip(URL_SCRUTINS)
    cutoff = date.today() - timedelta(days=JOURS_DETAIL)

    index = []
    OUT_DETAIL_DIR.mkdir(parents=True, exist_ok=True)
    numeros_recents = set()

    for nom in archive.namelist():
        if not nom.endswith(".json"):
            continue
        scrutin = json.loads(archive.read(nom))["scrutin"]
        resume = resume_scrutin(scrutin)
        index.append(resume)

        if date.fromisoformat(resume["date"]) >= cutoff:
            numeros_recents.add(resume["numero"])
            detail = detail_scrutin(scrutin, resume)
            (OUT_DETAIL_DIR / f"{resume['numero']}.json").write_text(
                json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    for fichier in OUT_DETAIL_DIR.glob("*.json"):
        if fichier.stem not in numeros_recents:
            fichier.unlink()

    index.sort(key=lambda s: int(s["numero"]), reverse=True)
    OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    OUT_INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(index)} scrutins indexés, {len(numeros_recents)} détails (fenêtre {JOURS_DETAIL}j).")


if __name__ == "__main__":
    main()
