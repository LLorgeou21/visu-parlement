"""Télécharge et transforme les données des scrutins depuis data.assemblee-nationale.fr.

Génère :
- data/actuality/scrutins_index.json : liste légère de tous les scrutins (pour une timeline)
- data/actuality/scrutins/<numero>.json : détail (par groupe + par député) des scrutins récents
- data/actuality/participation_deputes.json : participation par député sur toute la
  législature (calculée à la volée, sans garder le détail nominatif des vieux scrutins)
"""
import io
import json
import zipfile
from bisect import bisect_left
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

URL_SCRUTINS = "http://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip"

JOURS_DETAIL = 90  # fenêtre glissante pour laquelle on garde le détail nominatif

ROOT = Path(__file__).resolve().parent.parent
IN_DEPUTES = ROOT / "data" / "permanent" / "deputes.json"
OUT_INDEX = ROOT / "data" / "actuality" / "scrutins_index.json"
OUT_DETAIL_DIR = ROOT / "data" / "actuality" / "scrutins"
OUT_VOTES_GROUPE = ROOT / "data" / "actuality" / "votes_par_groupe.json"
OUT_PARTICIPATION = ROOT / "data" / "actuality" / "participation_deputes.json"
OUT_META = ROOT / "data" / "actuality" / "meta.json"


def charger_debuts_mandat() -> dict[str, str]:
    if not IN_DEPUTES.exists():
        return {}
    deputes = json.loads(IN_DEPUTES.read_text(encoding="utf-8"))
    return {d["id"]: d["debutMandat"] for d in deputes if d.get("debutMandat")}


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
        "dossierRef": dossier.get("dossierRef"),
        "typeVote": scrutin["typeVote"]["libelleTypeVote"],
        "resultat": scrutin["sort"]["code"],
        "votants": int(synthese["nombreVotants"]),
        "pour": int(decompte["pour"]),
        "contre": int(decompte["contre"]),
        "abstentions": int(decompte["abstentions"]),
    }


def votants_scrutin(scrutin: dict) -> list[str]:
    # Version légère de detail_scrutin() : juste qui a voté (peu importe quoi),
    # pour calculer la participation sur toute la législature sans avoir à
    # conserver le détail nominatif complet de chaque scrutin.
    groupes_brut = scrutin["ventilationVotes"]["organe"]["groupes"]["groupe"]
    if isinstance(groupes_brut, dict):
        groupes_brut = [groupes_brut]

    resultat = []
    for groupe in groupes_brut:
        nominatif = groupe["vote"]["decompteNominatif"]
        for bloc in ("pours", "contres", "abstentions"):
            resultat.extend(votants(nominatif.get(bloc)))
    return resultat


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
    votes_par_groupe: dict[str, list[dict]] = {}
    votes_par_depute: dict[str, int] = {}
    OUT_DETAIL_DIR.mkdir(parents=True, exist_ok=True)
    numeros_recents = set()

    for nom in archive.namelist():
        if not nom.endswith(".json"):
            continue
        scrutin = json.loads(archive.read(nom))["scrutin"]
        resume = resume_scrutin(scrutin)
        index.append(resume)

        for depute in votants_scrutin(scrutin):
            votes_par_depute[depute] = votes_par_depute.get(depute, 0) + 1

        if date.fromisoformat(resume["date"]) >= cutoff:
            numeros_recents.add(resume["numero"])
            detail = detail_scrutin(scrutin, resume)
            (OUT_DETAIL_DIR / f"{resume['numero']}.json").write_text(
                json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            for ligne in detail["parGroupe"]:
                votes_par_groupe.setdefault(ligne["groupe"], []).append({
                    "numero": resume["numero"],
                    "date": resume["date"],
                    "titre": resume["titre"],
                    "resultat": resume["resultat"],
                    "position": ligne["position"],
                    "pour": ligne["pour"],
                    "contre": ligne["contre"],
                    "abstentions": ligne["abstentions"],
                })

    for fichier in OUT_DETAIL_DIR.glob("*.json"):
        if fichier.stem not in numeros_recents:
            fichier.unlink()

    index.sort(key=lambda s: int(s["numero"]), reverse=True)
    for votes in votes_par_groupe.values():
        votes.sort(key=lambda v: int(v["numero"]), reverse=True)

    OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    OUT_INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_VOTES_GROUPE.write_text(
        json.dumps(votes_par_groupe, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    debuts_mandat = charger_debuts_mandat()
    dates_scrutins = sorted(date.fromisoformat(s["date"]) for s in index)

    def total_scrutins_depuis(depute: str) -> int:
        debut = debuts_mandat.get(depute)
        if not debut:
            return len(dates_scrutins)  # date de début inconnue : on ne peut pas affiner
        position = bisect_left(dates_scrutins, date.fromisoformat(debut))
        return len(dates_scrutins) - position

    participation = {
        depute: {"votes": nb, "totalScrutins": total_scrutins_depuis(depute)}
        for depute, nb in votes_par_depute.items()
    }
    OUT_PARTICIPATION.write_text(
        json.dumps(participation, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    OUT_META.write_text(
        json.dumps({"genereLe": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"{len(index)} scrutins indexés, {len(numeros_recents)} détails (fenêtre {JOURS_DETAIL}j).")


if __name__ == "__main__":
    main()
