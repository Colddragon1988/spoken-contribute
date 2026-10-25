"""Spoken-Beiträge hochladen: was das WoW-Addon Spoken und der Spiel-Cache sammeln, an
spoken.rusty.one schicken, archivieren und danach aufräumen.

Module:
  system    was je Betriebssystem anders ist (Ordner, WoW-Suche, laufende Prozesse)
  settings  Einstellungen und Zugangsdaten
  wowdata   die Dateien in der WoW-Installation lesen und leeren
  api       die Website
  upload    ein Upload-Durchgang
  history   Archiv und Verlauf aller Uploads
  gui       das Fenster
  main      Startpunkt (Fenster oder Terminal)
"""
VERSION = "2.0"
