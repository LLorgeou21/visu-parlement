"""Télécharge et transforme les données des députés en exercice depuis data.assemblee-nationale.fr."""
import io
import json
import zipfile
from pathlib import Path
from urllib.request import urlopen

URL_DEPUTES = (
    "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/"
    "deputes_actifs_mandats_actifs_organes_divises/"
    "AMO40_deputes_actifs_mandats_actifs_organes_divises.json.zip"
)

ROOT = Path(__file__).resolve().parent.parent
OUT_DEPUTES = ROOT / "data" / "permanent" / "deputes.json"
OUT_GROUPES = ROOT / "data" / "permanent" / "groupes.json"


def telecharger_zip(url: str) -> zipfile.ZipFile:
    with urlopen(url) as reponse:
        return zipfile.ZipFile(io.BytesIO(reponse.read()))


def charger_json(archive: zipfile.ZipFile, prefixe: str) -> dict[str, dict]:
    fichiers = {}
    for nom in archive.namelist():
        if nom.startswith(prefixe) and nom.endswith(".json"):
            fichiers[Path(nom).stem] = json.loads(archive.read(nom))
    return fichiers


def mandat_actif(mandats: list[dict], type_organe: str) -> dict | None:
    for mandat in mandats:
        if mandat.get("typeOrgane") != type_organe or mandat.get("dateFin") is not None:
            continue
        if type_organe == "ASSEMBLEE" or mandat.get("nominPrincipale") == "1":
            return mandat
    return None


def main() -> None:
    archive = telecharger_zip(URL_DEPUTES)
    acteurs = charger_json(archive, "acteur/")
    organes = charger_json(archive, "organe/")

    groupes: dict[str, dict] = {}
    deputes = []

    for fiche in acteurs.values():
        acteur = fiche["acteur"]
        ident = acteur["etatCivil"]["ident"]
        mandats = acteur["mandats"]["mandat"]
        if isinstance(mandats, dict):
            mandats = [mandats]

        mandat_assemblee = mandat_actif(mandats, "ASSEMBLEE")
        if mandat_assemblee is None:
            continue  # plus en exercice

        mandat_gp = mandat_actif(mandats, "GP")
        groupe_ref = mandat_gp["organes"]["organeRef"] if mandat_gp else None

        if groupe_ref and groupe_ref not in groupes:
            organe = organes[groupe_ref]["organe"]
            groupes[groupe_ref] = {
                "id": groupe_ref,
                "nom": organe["libelle"],
                "abrev": organe["libelleAbrege"],
                "couleur": organe.get("couleurAssociee"),
            }

        election = mandat_assemblee.get("election", {}).get("lieu", {})

        deputes.append({
            "id": acteur["uid"]["#text"],
            "civilite": ident["civ"],
            "prenom": ident["prenom"],
            "nom": ident["nom"],
            "groupe": groupe_ref,
            "departement": election.get("departement"),
            "numCirconscription": election.get("numCirco"),
            "region": election.get("region"),
        })

    OUT_DEPUTES.parent.mkdir(parents=True, exist_ok=True)
    OUT_DEPUTES.write_text(
        json.dumps(sorted(deputes, key=lambda d: d["nom"]), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_GROUPES.write_text(
        json.dumps(sorted(groupes.values(), key=lambda g: g["nom"]), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"{len(deputes)} députés et {len(groupes)} groupes écrits.")


if __name__ == "__main__":
    main()
