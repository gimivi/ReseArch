<?php
// cfg/cfg_privacy.example.php — MODELLO dei dati dell'informativa sul trattamento dei dati personali (privacy.php).
// Copiarlo in cfg/cfg_privacy.php (escluso da git) e compilarlo. Senza il file si usa questo modello.
// Da compilare per ogni installazione, d'accordo con il Responsabile della protezione dei dati (RPD/DPO)
// dell'ente. Finché 'controller' è vuoto la pagina avvisa che l'informativa è in preparazione.
// I tempi di conservazione si leggono da cfg/cfg_maintenance.php (activity_log_days, guest_log_days).
return [
    'controller'       => '',   // Titolare del trattamento (ente), es. "Università …, Dipartimento di …"
    'controller_email' => '',   // contatto del titolare
    'dpo_email'        => '',   // Responsabile della protezione dei dati (RPD/DPO)
    // Referente della piattaforma (es. responsabile scientifico): a chi rivolgersi per la piattaforma.
    // Vuoto = la riga non compare.
    'contact_name'     => '',
    'contact_role'     => '',
    'contact_email'    => '',
    'updated'          => '',   // data dell'ultima revisione dell'informativa (AAAA-MM-GG)
];
