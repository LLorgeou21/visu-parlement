# Visu Parlement

Interface de suivi quasi temps réel des travaux de l'Assemblée nationale française.

## Architecture

- `data/permanent/` — données qui changent rarement (députés, groupes politiques, mandats)
- `data/actuality/` — données d'actualité (votes, débats, agenda, commissions), régénérées périodiquement
- `scripts/` — scripts Python de collecte et transformation depuis [data.assemblee-nationale.fr](https://data.assemblee-nationale.fr/)
- `frontend/` — interface statique consommant les fichiers JSON générés
- `.github/workflows/` — jobs planifiés (collecte des données, build/déploiement du site)

## Hébergement

GitHub Actions (collecte planifiée) + GitHub Pages (front statique).

## Scripts de collecte

La plupart des scripts n'ont aucune dépendance externe (stdlib uniquement).
`collecte_resumes_lois.py` est l'exception : il lit les textes de loi (PDF) et a
besoin de `pip install -r requirements.txt`.
