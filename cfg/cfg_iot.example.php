<?php
// cfg/cfg_iot.example.php — MODELLO della configurazione dei broker MQTT per i dispositivi
// (_doc/arch-iot-dispositivi.md §8, passo 5a).
//
// Copiarlo in cfg/cfg_iot.php (escluso da git: contiene password) e compilare i broker.
// Senza cfg/cfg_iot.php il canale mqtt del nodo Context Device dice "nessun broker configurato".
//
// Ogni broker:
//   title     nome mostrato nei flow
//   url       indirizzo per i BROWSER: WebSocket sicuro wss://host:porta/percorso
//             (la pagina è in https: un ws:// non cifrato verrebbe bloccato dal browser)
//   username, password
//             account usato dai browser. In questa prima forma è CONDIVISO: chi apre un flow col
//             canale mqtt lo riceve (lo vede negli strumenti per sviluppatori del browser). Sul
//             broker dargli solo i permessi sotto "prefix" (§8.3). Gli account dei dispositivi
//             sono altri e stanno solo nel firmware (secrets.h).
//   prefix    radice dei topic: ogni dispositivo usa <prefix>/<id dispositivo>/in|out/…
//             Lettere, cifre, _ - e / interni. Su un broker PUBBLICO usare una radice difficile da
//             indovinare (es. "ra-7f3k9q"): chiunque altro potrebbe leggere e scrivere.
//   guests    true = anche gli ospiti (accesso con account esterno) ricevono le credenziali
//   device_host, device_port
//             solo promemoria per chi scrive il firmware (MQTT con TLS dai dispositivi, di solito 8883)
//
// Il browser si collega DIRETTAMENTE al broker: il server della piattaforma (anche un hosting
// condiviso) non deve tenere aperte connessioni. Quando la CSP diventerà bloccante, aggiungere
// l'indirizzo wss dei broker a connect-src (.htaccess e Web.config).
return [
    'brokers' => [

        // Broker gestito con piano gratuito (HiveMQ Cloud, EMQX Cloud Serverless…): creare nella
        // sua console un account per i browser e uno per ogni dispositivo.
        'cloud' => [
            'title'       => 'HiveMQ Cloud',
            'url'         => 'wss://xxxxxxxx.s1.eu.hivemq.cloud:8884/mqtt',
            'username'    => '',
            'password'    => '',
            'prefix'      => 'ra',
            'guests'      => false,
            'device_host' => 'xxxxxxxx.s1.eu.hivemq.cloud',
            'device_port' => 8883,
        ],

        // Broker pubblico di prova: nessuna password, NESSUNA RISERVATEZZA. Solo per provare, mai
        // con attuatori o dati veri. Togliere il commento per usarlo.
        // 'test' => [
        //     'title'       => 'Public test broker (no privacy)',
        //     'url'         => 'wss://broker.hivemq.com:8884/mqtt',
        //     'username'    => '',
        //     'password'    => '',
        //     'prefix'      => 'ra-cambiami',
        //     'guests'      => false,
        //     'device_host' => 'broker.hivemq.com',
        //     'device_port' => 1883,
        // ],
    ],
];
