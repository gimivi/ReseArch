# Glossario italiano → inglese

> Creato il 2026-10-09. Riferimento per le traduzioni dei cataloghi e per i nodi FLE
> (vedi `_doc/arch-i18n-a11y.md`). Un termine nuovo si aggiunge qui prima di usarlo.

## Vocabolario (variabile)

Questi termini **non sono fissi**: ogni profilo (§2.6 del documento) può sostituirli, per esempio
"mostra" invece di "ricerca" in un museo. La tabella dà i termini del profilo di base (ricerca).
Le frasi che li contengono hanno chiavi che finiscono con `.@`.

| Italiano | Inglese | Note |
|---|---|---|
| ricerca | research | al plurale "researches" solo nei nomi tecnici; nell'interfaccia "research projects" |
| work package (WP) | work package (WP) | |
| oggetto | object | |
| modello | model | |
| cartella / sottocartella | folder / subfolder | |
| autore / autori | author / authors | crediti: "credits" |

## Termini della piattaforma (fissi)

| Italiano | Inglese | Note |
|---|---|---|
| permesso / ruolo | permission / role | |
| livello di interazione | interaction level | |
| abilitazione | capability | |
| visibilità | visibility | |
| sola visualizzazione | view only | |
| pannello | panel | |
| finestra (modale) | dialog | "window" solo per le finestre del window manager |
| app (TJS, OSD…) | app | |
| configurazione della dashboard | dashboard configuration | |
| caricamento (upload) | upload | |
| ricaricare | reload | |

## Ruoli (`cfg/roles.php`, variabili: chiavi `role.<codice>.@`)

Nel database ci sono solo i codici (una lettera). I nomi qui sotto sono quelli di `it.json` /
`en.json` (approvati il 2026-10-09, da perfezionare). `cfg/roles.php` non serve più per l'interfaccia.

| Codice | Italiano | Inglese |
|---|---|---|
| X | Amministratore | Administrator |
| P | Responsabile scientifico | Principal Investigator |
| W | Responsabile di work package | Work Package Leader |
| I | Ricercatore | Investigator |
| C | Collaboratore (ruolo di ricerca e WP, 2026-10-10) | Collaborator |
| U | Utente (ruolo di piattaforma, livello 20, 2026-10-10) | User |
| V | Osservatore | Viewer |
| A, T, E, G | non usati | |

Modello completo: `_doc/arch-permessi.md` §11.

## Azioni comuni (`common.*`)

| Italiano | Inglese |
|---|---|
| Salva / Salva con nome | Save / Save as |
| Annulla | Cancel |
| Chiudi | Close |
| Elimina | Delete |
| Modifica | Edit |
| Rinomina | Rename |
| Aggiungi | Add |
| Cerca | Search |
| Conferma | Confirm |
| Copia / Duplica | Copy / Duplicate |

## Flow e nodi

| Italiano | Inglese | Note |
|---|---|---|
| flow | flow | |
| nodo | node | |
| porta (ingresso / uscita) | port (input / output) | |
| proprietà | property | |
| fatto | done | uscita evento, sempre per prima |
| valore | value | |
| errore | error | |
| attivazione / scatto | trigger | |
| canale | channel | |
| testo | text | |
| colore | color | |
| sinistra / destra | left / right | |
| validazione (flow) | validation / review | |
| libreria dei nodi | node library | |

## Livelli di visibilità (`_show` / `_share`)

Nel database ci sono solo numeri. Oggetti, modelli, flow e work package usano le chiavi comuni
`visibility.*`; le ricerche (`res_show`) hanno chiavi proprie al femminile (`modal.researches.show.*`).

| Inglese | Italiano | Chiave |
|---|---|---|
| Author | Autore | `visibility.author.@` |
| Workgroup | Gruppo di lavoro | `visibility.workgroup` |
| Research | Ricerca | `visibility.research.@` |
| Dissemination | Divulgazione | `visibility.dissemination` |
| Public | Pubblico (ricerche: Pubblica) | `visibility.public` |
| Guests | Ospiti | `visibility.guests` (ricerche: `modal.researches.show.guests`) |
| Private (solo ricerche) | Privata | `modal.researches.show.private` |

## Porte, proprietà e valori dei nodi FLE (fase 4)

I nodi sono **solo in inglese** (`_doc/arch-i18n-a11y.md` §4). Nomi in camelCase quando sono più
parole (`endPoint`, `castShadow`); la freccia iniziale delle porte di passaggio resta (`→oggetto` →
`→object`). I tipi delle porte (`number`, `string`, `object`…) sono già in inglese e non cambiano.

| Italiano | Inglese | | Italiano | Inglese |
|---|---|---|---|---|
| fatto | done | | punto / punti | point / points |
| valore | value | | punto finale | endPoint |
| nome / nomi | name / names | | origine | origin |
| oggetto / oggetti | object / objects | | curva | curve |
| materiale / materiali | material / materials | | opacità | opacity |
| colore | color | | intensità | intensity |
| testo | text | | posizione / rotazione / scala | position / rotation / scale |
| errore | error | | larghezza / altezza / profondità | width / height / depth |
| trovato | found | | centro / raggio | center / radius |
| indice | index | | sorgente / destinazione | source / target |
| lista / elenco | list | | contenuto | content |
| risultato | result | | immagine | image |
| dati | data | | pagina | page |
| chiave | key | | livello | layer (grafico) / level (gerarchia) |
| messaggio | message | | etichetta / titolo | label / title |
| stato | state | | tipo | type |
| canale | channel | | durata / ritardo | duration / delay |
| quanti / numero di | count | | secondi | seconds |
| percorsi | paths | | velocità | speed |
| attivo / abilitato | active / enabled | | visibile | visible |
| avvia / ferma / pausa | start / stop / pause | | interrompi | stop |
| carica / salva / elimina | load / save / delete | | aggiungi / rimuovi | add / remove |
| mostra / nascondi | show / hide | | ricevuto / inviato | received / sent |
| sinistra / destra | left / right | | sopra / sotto | top / bottom |
| primo / ultimo | first / last | | successivo / precedente | next / previous |
| vero / falso | true / false | | esercitazione | exercise |

