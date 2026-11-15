<?php
// cfg/cfg_google.example.php — MODELLO delle chiavi dei servizi Google.
// Copiarlo in cfg/cfg_google.php (escluso da git) e compilarlo.
//
// maps_api_key: chiave della Maps JavaScript API (Google Cloud Console → API e servizi →
//   Credenziali). Il browser la riceve comunque nella pagina: LIMITARLA ai referrer HTTP
//   dei propri domini (https://www.dominio.it/*) e alle sole API Maps usate.
//   Vuota = Google Maps non viene caricato e l'App MPS non funziona.
// maps_version: canale della API ('weekly', 'quarterly', 'beta').
return [
    'maps_api_key' => '',
    'maps_version' => 'weekly',
];
