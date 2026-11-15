# Cataloghi delle lingue

> Riferimento completo: `_doc/arch-i18n-a11y.md` §2. Termini: [GLOSSARY.md](GLOSSARY.md).

## File

| File | Contenuto |
|---|---|
| `it.json` | italiano, **lingua sorgente**: ogni chiave nasce qui |
| `en.json` | inglese, deve essere completo |
| `<lingua>.json` | un'altra lingua: copia di `en.json` (o `it.json`) tradotta |
| `<lingua>@<profilo>.json` | vocabolario di un profilo (es. `it@museum.json`): **solo** le frasi che cambiano |

Ogni catalogo ha la chiave `lang.name` con il nome della lingua scritto nella lingua stessa
(`"Italiano"`, `"English"`, `"Deutsch"`): è il nome che compare nel selettore. Un nuovo file
`<lingua>.json` compare nel selettore da solo, senza modificare il codice. Il codice della lingua è
quello ISO 639-1 (`de`, `fr`, `es`…), eventualmente con il paese (`pt-BR`).

## Regole

- Chiavi piatte a punti: `<area>.<elemento>.<cosa>`, es. `modal.objects.title`.
- `common.*` per le parole ripetute ovunque (Salva, Annulla, Chiudi…).
- Segnaposto con nome tra graffe, da lasciare così come sono: `"{n} oggetti"` → `"{n} objects"`.
- Plurali: `chiave.one` / `chiave.other` (e `.zero`, `.two`, `.few`, `.many` per le lingue che li
  hanno, secondo le regole CLDR).
- **Chiavi che finiscono con `.@`**: la frase contiene un termine del vocabolario ("ricerca",
  "work package", "oggetto", un ruolo…). Si traduce normalmente; un profilo può riscriverla tutta.
- Si traducono frasi intere: mai comporre una frase con pezzi presi da altre chiavi.
- Ordine alfabetico delle chiavi, JSON con rientro di 2 spazi, UTF-8.

## Ordine di ricerca

`<lingua>@<profilo>` → `<lingua>` → `it@<profilo>` → `it` → la chiave stessa (così una chiave
mancante si vede subito).

## Nuovo profilo (vocabolario)

1. `node _dev/i18n-check.mjs --profile <nome>` elenca le frasi `.@` da riscrivere.
2. Creare `it@<nome>.json` (e le altre lingue) con quelle frasi riscritte.
3. Impostare `researches.res_profile = '<nome>'` sulle ricerche che lo usano. Fuori dalle ricerche
   vale `default_profile` in `cfg/cfg_ini.php` (se manca: `research`).

## Controllo

```
node _dev/i18n-check.mjs
```
