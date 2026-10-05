# Vreetspiratie

Alle gerechten die we ooit maakten in een overzicht, voor als de vraag komt: waar heb je zin in?

Per gerecht: naam, tags, een cijfer per persoon en een foto. Geen recepten.

## Opbouw

- `index.html`, `app.js`: de hele app, zonder buildstap
- `sw.js`, `manifest.webmanifest`, `icons/`: installeerbaar op de telefoon en offline bruikbaar
- `firebase-config.js`: instellingen van het Firebase-project
- `firestore.rules`: beveiligingsregels, plakken in Firebase Console bij Firestore, tabblad Regels

## Firebase

Gebruikt Authentication (inloggen met Google) en Firestore. Alleen de Google-accounts die in de Firestore-regels staan hebben toegang.
In `firestore.rules` staan placeholders: de echte e-mailadressen vul je alleen in Firebase Console in, niet in deze repo.
Het webadres van de app moet bij Authentication, Instellingen, Geautoriseerde domeinen staan.

## Publiceren

GitHub Pages serveert de `main` branch. Elke push is een nieuwe versie.
Verhoog `VERSIE` in `sw.js` na een wijziging, zodat telefoons de nieuwe versie ophalen.
