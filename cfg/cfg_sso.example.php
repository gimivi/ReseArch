<?php
// cfg/cfg_sso.example.php — MODELLO della configurazione dell'accesso con account esterni
// (_doc/arch-sso-ospiti.md, istruzioni per registrare le app: _doc/guida-sso-registrazione.md).
//
// Copiarlo in cfg/cfg_sso.php (escluso da git: contiene segreti) e compilare i codici.
// Un fornitore con client_id vuoto non compare nella pagina di accesso.
// L'indirizzo di ritorno da registrare presso ogni fornitore è:
//     https://<indirizzo del sito>/api/sso_callback.php
// (ricavato da base_url di cfg/cfg_ini.php, o dalla richiesta: ogni installazione ha il suo).
return [
    'providers' => [
        'orcid' => [
            'client_id'     => '',          // APP-XXXXXXXXXXXXXXXX
            'client_secret' => '',
            'sandbox'       => false,       // true = sandbox.orcid.org (prove con account di prova)
        ],
        'google' => [
            'client_id'     => '',          // ....apps.googleusercontent.com
            'client_secret' => '',
        ],
        'github' => [
            'client_id'     => '',
            'client_secret' => '',
        ],
    ],
    // Ospiti: false = l'accesso esterno vale solo per i membri che hanno collegato l'account
    'guests_enabled' => true,
];
