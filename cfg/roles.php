<?php 
// config/roles.php
return [
  'X' => 'Administrator',
  'A' => 'Action Leader',
  'E' => 'Editor',
  'G' => 'Guest',
  'P' => 'Principal Investigator',
  'I' => 'Investigator', 
  'T' => 'Task Leader',
  'V' => 'Viewer',
  'W' => 'Work Package Leader',
  'C' => 'Collaborator',   // ruolo di ricerca/WP (2026-10-10)
  'U' => 'User',           // ruolo di piattaforma, livello 20 (2026-10-10)
];
// Modello completo: _doc/arch-permessi.md §11. I nomi mostrati vengono dal catalogo (role.<codice>.@).

// A,E,P,I,T,V  sono utilizzati per indicare le attività che pososno svolgere all'interno di ricerche\workpackage\oggetti\modelli
// A,V,R, sono utilizzati anche a livello di User per accesso a livelli diversi di UI 
// E e G attualmente non sono utilizzati nel sistema di autenticazione