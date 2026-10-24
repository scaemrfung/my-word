# My Word

A classroom projector game for Mr. Fung's class. Teams race to call out a word from the letter cards in the middle. The teacher gives those cards to the team. Most cards wins.

**Play it:** https://scaemrfung.github.io/my-word/

Open that link, then full-screen the browser on the projector, a Chromebook, or an iPad. There is no account, no install, and no student names. Teams are colours only: Red, Blue, Green, Yellow, Purple, and Orange. Setup choices stay in this browser (`localStorage`).

The site is the files on the `main` branch, folder `/` (root). If the link is not up yet, open the repository's **Settings → Pages**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save. GitHub builds the game from there.

## How a round works

1. Pick 2–6 teams, a shortest word (2, 3, or 4 letters; 3 is the usual), and auto or manual flips.
2. Letter cards turn face up one at a time. Auto mode waits 2–10 seconds. Manual mode uses **Next letter** or the space bar.
3. A team calls a word. Tap the letters (they show the order you tapped), optionally type the word so the class can see it, then tap that team's colour.
4. Those cards fly to the team's pile. The score is the number of cards.
5. TH, ER, IN, and QU count as two letters. `?` is any letter and counts as one. The word must reach the shortest length.
6. **Not a word:** tap the team that guessed wrong. Every other team takes one card from the table, or from the deck if the table has run out.
7. **Undo** takes back the last move. **Pause** stops new letters and the music. **End round** counts the cards at any time. A short tune plays during the round (Music on/off and the volume stay in this browser). It gets quieter while letters are being chosen, and a fanfare plays for the winner.
8. When the deck is empty, finish any word that is still long enough. The round ends on its own once there are not enough letters left. **Play again** shuffles a new deck.

The deck has 55 cards, weighted toward common English letters, including the two-letter cards and two wild cards. It is shuffled every game.

## Run it on this computer

These files are plain HTML, CSS, and JavaScript. No build step.

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080
