# Parité 15×15

Modèle 3D tactile d'un Rubik's Cube 15×15 qui détecte la parité d'arête et montre, mouvement par mouvement (bouton lecture), comment la résoudre.

Tout tient dans une page web : elle marche sur téléphone, sans installation.

## Utilisation

Ouvrir `dist/index.html` dans un navigateur (ou la version publiée). Dans l'app Claude sur téléphone, l'appareil photo peut être bloqué : ouvrir alors la page dans Chrome ou Safari.

- **Signaler ma parité** : choisir les deux couleurs de l'arête fautive (ex. blanc-vert) et les paires d'ailes retournées (2 et 14, 3 et 13…). Le plus rapide, sans photo. Le cube s'affiche de face, l'arête fautive en haut devant, et la page dit comment tenir le cube.
- **Glisser** : tourner le cube. **Pincer** : zoomer.
- **Depuis mes photos** : choisir la face, toucher ses 4 coins (haut-gauche, haut-droit, bas-droit, bas-gauche), vérifier l'aperçu, *Appliquer*. Une photo en biais qui montre 3 faces sert pour les 3. Photographier les 6 faces.
  - Faces F, R, B, L : la face U en haut. Face U : le côté B en haut. Face D : le côté F en haut.
- **Peindre** : corriger un sticker mal lu.
- **▶** : joue la solution. **◀ / ▶|** : pas à pas. On peut aussi toucher un mouvement de la liste.

Notation : `x`, `y`, `z` = tourner tout le cube (décrit en clair dans la page), `R` face de droite (¼ de tour horaire vu de droite), `R'` inverse, `R2` demi-tour, `4R` uniquement la 4ᵉ tranche depuis la droite.

## Méthode

Sur un cube impair, l'aile centrale de chaque arête (fixe) sert de référence. Une parité d'arête = les deux ailes d'une même orbite retournées dans une arête. La solution :

1. fait tourner le cube entier (x, y, z) pour mettre l'arête en haut devant (UF), si elle n'y est pas déjà ;
2. applique `r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2`, où `r`/`l` sont les tranches de chaque orbite fautive (tranche k+1 pour l'aile n°k+1 depuis le coin) ;

La simulation vérifie que cet algorithme ne modifie que les 2 ailes visées (centres et autres arêtes intacts).

## Développement

```
node test/core.test.js   # tests du moteur (mouvements, détection, solution)
node build.js            # génère dist/index.html et dist/parite15.html
```

- `src/core.js` : moteur du cube (sans DOM)
- `src/app.js` : rendu 3D canvas, gestes, lecteur, import photo
- `src/page.html`, `src/style.css` : interface
