# Échecs Halal Online

Version multijoueur indépendante du jeu **Échecs Halal**. Deux joueurs peuvent jouer depuis deux appareils différents en créant une salle et en partageant son lien ou son code.

## Fonctionnalités

- Salles privées avec code à 6 caractères.
- Créateur avec les blancs, invité avec les noirs.
- Synchronisation des coups en temps réel par Socket.IO.
- Vérification des coups côté serveur avec `chess.js` : coups légaux, échec et mat, pat, roque, prise en passant et promotion.
- Reconnexion à une salle avec le lien de reprise enregistré dans le navigateur.
- Proposition de nulle, acceptation/refus, abandon et nouvelle partie.
- Plateau responsive, pièces géométriques, roi couronné sans crucifix et reine avec diamant.
- Mode plein écran.

## Lancer sur ton ordinateur

Il faut installer **Node.js 20 ou une version plus récente**.

1. Extrais le fichier ZIP.
2. Ouvre un terminal dans le dossier `echecs_halal_online`.
3. Lance :

   ```bash
   npm install
   npm start
   ```

4. Ouvre `http://localhost:3000` dans ton navigateur.
5. Pour un test sur le même ordinateur, ouvre aussi le site dans un autre navigateur ou une fenêtre privée, puis rejoins la salle avec le code.

`localhost` n'est accessible que depuis ton propre ordinateur. Pour jouer avec une personne qui est ailleurs, il faut déployer le serveur sur Internet et lui envoyer l'adresse publique.

## Mettre le jeu en ligne gratuitement avec Render

Le projet contient déjà `render.yaml`.

1. Crée un dépôt GitHub et ajoute-y tous les fichiers de ce dossier (pas le ZIP lui-même).
2. Dans Render, choisis **New → Web Service**, puis connecte le dépôt GitHub.
3. Render détecte le projet. Vérifie ces paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : `Free` pour tester.
5. Lance le déploiement. Render donnera une adresse publique en `onrender.com`.
6. Ouvre cette adresse, crée une salle, puis partage le lien généré avec ton adversaire.

Tu peux aussi utiliser **New → Blueprint** pour laisser Render lire le fichier `render.yaml` fourni.

Le service gratuit Render peut s'endormir après 15 minutes sans trafic entrant. Le premier accès après cette pause peut demander environ une minute pour redémarrer. Les parties sont gardées en mémoire sur le serveur : un redémarrage ou un nouveau déploiement peut donc les effacer. Ce projet convient pour jouer et tester, pas encore pour conserver des parties ou gérer des comptes.

## Notes techniques

- `server.js` est le serveur Node.js et le validateur officiel des coups de la partie.
- `public/index.html` contient l'interface web.
- Les dépendances sont déclarées dans `package.json`.
- Le serveur écoute le port fourni par l'hébergeur (`PORT`) ou le port `3000` en local.
- Les salles et les parties ne sont pas enregistrées dans une base de données.
