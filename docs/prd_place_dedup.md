# PRD - Deduplicacion y Agrupacion de Lugares (Place Merging)

## Context

El pipeline de ingesta crea filas en `places` deduplicando por `google_place_id` exacto o por `canonical_name` exacto. Variantes como `Club La Dalia` y `Club La Dalia, San Salvador` pueden terminar como filas separadas.

## Goal

Cada lugar real debe aparecer una sola vez, con menciones, engagement e indice de busqueda consolidados.

## Capas

1. Prevencion en ingesta: buscar lugares similares antes de insertar.
2. Correccion: script `merge:places` con dry-run por defecto y `--apply` para fusionar.
3. Defensa en lectura: agrupar filas similares antes de calcular scores.

## Decisiones

- Backend: `findy-workflow`.
- Normalizacion: TypeScript, sin extension `unaccent`.
- Proximidad: caja aproximada de 500 m (`0.005` grados).
- Sin cambios de schema ni tipos publicos.

## Success Criteria

- Reingestar una variante de nombre no crea una fila nueva.
- `npm run merge:places` muestra candidatos sin aplicar cambios.
- `npm run merge:places -- --apply` mueve menciones, recalcula contadores, borra duplicados y reindexa el canonico.
- El listado de places deduplica filas residuales antes del scoring.
