<?php
// cfg/cfg_maintenance.php — soglie della pulizia periodica (finestra "Manutenzione database",
// api/db_maintenance_tool.php). Giorni; 0 = controllo disattivato (non si cancella mai per età).
return [
    'email_tokens_days'    => 7,     // token di verifica email scaduti o già usati da più di N giorni
    'sessions_days'        => 90,    // sessioni senza attività da più di N giorni
    'csp_reports_days'     => 90,    // segnalazioni CSP non più viste da N giorni
    'deleted_drawings_days'=> 30,    // disegni PJS segnati come eliminati da più di N giorni
    'activity_log_days'    => 365,   // voci del log attività più vecchie di N giorni
    'events_days'          => 0,     // eventi (dati dei sensori, tabella events): 0 = si tengono sempre
    'a11y_feedback_days'   => 0,     // segnalazioni di accessibilità GESTITE da più di N giorni: 0 = si tengono
    'guest_log_days'       => 365,   // registro degli accessi degli ospiti (guest_access_log): 12 mesi, vedi informativa
];
