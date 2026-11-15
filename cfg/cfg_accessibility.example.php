<?php
// cfg/cfg_accessibility.example.php — MODELLO della dichiarazione di accessibilità e segnalazioni (fase 7 di
// _doc/arch-i18n-a11y.md). Letto da accessibilita.php e api/a11y_feedback.php.
// Copiarlo in cfg/cfg_accessibility.php (escluso da git) e compilarlo. Senza il file si usa questo modello.
return [
    // Dove arrivano le segnalazioni del modulo. Vuoto = a tutti gli amministratori (user_type X).
    'feedback_email'        => '',

    // Dichiarazione compilata su https://form.agid.gov.it (obbligatoria, da aggiornare entro il
    // 23 settembre di ogni anno): indirizzo pubblico e data dell'ultima pubblicazione (AAAA-MM-GG).
    // Finché sono vuoti la pagina mostra l'avviso "dichiarazione in preparazione".
    'agid_declaration_url'  => '',
    'agid_declaration_date' => '',

    // Ente e responsabile, come nella dichiarazione AgID
    'organization'          => '',
    'contact_email'         => '',

    // Procedura di attuazione: dove rivolgersi se la risposta manca o non soddisfa
    // (Difensore civico per il digitale). Verificare l'indirizzo in vigore.
    'enforcement_url'       => 'https://difensoredigitale.it/',
];
