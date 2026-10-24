# My Word

A classroom projector game for Mr. Fung's class. Teams race to call out a word from the letter cards in the middle. The teacher gives those cards to the team. Most cards wins.

**Play it:** https://scaemrfung.github.io/my-word/

Open that link, then full-screen the browser on the projector, a Chromebook, or an iPad. There is no account, no install, and no student names. Teams are colours only: Red, Blue, Green, Yellow, Purple, and Orange. Setup choices stay in this browser (`localStorage`).

The site is the files on the `main` branch, folder `/` (root). If the link is not up yet, open the repository's **Settings → Pages**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save. GitHub builds the game from there.

## How a round works

1. Pick 2–6 teams, a shortest word (2, 3, or 4 letters; 3 is the usual), and auto or manual flips.
2. Letter cards turn face up one at a time. Auto mode waits 2–10 seconds. Manual mode uses **Next letter** or the space bar.
3. A team calls a word. Tap the letters (they show the order you tapped), optionally type the word so the class can see it, then tap that team's colour.
4. Spell check is on unless you turn it off in Setup. The letters, in tap order, have to spell a real word. TH, ER, IN, and QU each add both letters. `?` can be any letter. A green check means the word is in the list, and that word flashes for the class. If it is not a word, the cards stay on the table and a red "Not a word" message shows. **Allow anyway** gives the cards to that team if you know the list missed one.
5. Those cards fly to the team's pile. The score is the number of cards.
6. TH, ER, IN, and QU count as two letters. `?` is any letter and counts as one. The word must reach the shortest length. If you type a word, it has to match the letters you tapped.
7. **Not a word** (the penalty button): tap the team that guessed wrong. Every other team takes one card from the table, or from the deck if the table has run out.
8. **Undo** takes back the last move, including an award and Allow anyway. **Pause** stops new letters and the music. **End round** counts the cards at any time. A short tune plays during the round (Music on/off and the volume stay in this browser). It gets quieter while letters are being chosen, and a fanfare plays for the winner. A soft buzz plays on a rejected word when music is on.
9. When the deck is empty, finish any word that is still long enough. The round ends on its own once there are not enough letters left. **Play again** shuffles a new deck.

The deck has 55 cards, weighted toward common English letters, including the two-letter cards and two wild cards. It is shuffled every game.

## Word list

Spell check uses `words.txt`, loaded once in the browser. No network lookup. It is derived from [SCOWL](http://wordlist.aspell.net/) 2020.12.07, size 60 (the size SCOWL recommends for spell checking): everyday English plus American, British, Canadian, and Australian spellings and close variants. 80,199 words, lowercase, two or more letters. Profanity, slurs, and adult words are removed for the classroom.

Copyright 2000-2018 Kevin Atkinson. Permission to use, copy, modify, distribute and sell these word lists for any purpose is granted without fee, provided that the above copyright notice appears in all copies and that both that copyright notice and this permission notice appear in supporting documentation. The list is provided "as is" without express or implied warranty. SCOWL also draws on public-domain sources, including 12Dicts and the Moby lexicon.

## Run it on this computer

These files are plain HTML, CSS, and JavaScript. No build step.

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080
