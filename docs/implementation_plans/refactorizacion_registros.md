# Plan de Implementación: Refactorización de Registros (Config Box)

Este plan detalla los pasos para separar los datos estáticos de los contratos del juego en una "Caja de Configuración" (Config Box), reduciendo el tamaño de las cajas mutables y optimizando el almacenamiento on-chain.

## Estructura de Datos Propuesta

### Config Box (Inmutable)
- **Script**: `false.es`
- **Registro R4**: `Coll[Coll[Byte]]` - Jueces Invitados.
- **Registro R5**: `Coll[Long]` - Parámetros Numéricos.
- **Registro R6**: `Coll[Coll[Byte]]` - Game Provenance (`[gameDetailsJson, participationTokenId]`).
- **Registro R7**: `Coll[Byte]` - Hash del Secreto `S`.

### Game Active Box (Refactorizada)
- **Registro R4**: `Int` - Estado del Juego (`0`).
- **Registro R5**: `Coll[Byte]` - Semilla del Juego.
- **Registro R6**: `Coll[Byte]` - Config Box ID.

### Game Resolution Box (Refactorizada)
- **Registro R4**: `Int` - Estado del Juego (`1`).
- **Registro R5**: `Coll[Byte]` - Semilla del Juego.
- **Registro R6**: `(Coll[Byte], Coll[Byte])` - `(revealedSecretS, winnerCandidateCommitment)`.
- **Registro R7**: `Coll[Long]` - `[resolutionDeadline, effectiveJudgeComm, effectiveResolverComm]` (Dinámico, comisiones pueden cambiar por penalización).
- **Registro R8**: `Coll[Byte]` - Resolver PK (Dinámico).
- **Registro R9**: `Coll[Byte]` - Config Box ID.

### Game Cancellation Box (Refactorizada)
- **Registro R4**: `Int` - Estado del Juego (`2`).
- **Registro R5**: `Long` - Cooldown Height.
- **Registro R6**: `Coll[Byte]` - Revealed Secret.
- **Registro R7**: `Long` - Remaining Value.
- **Registro R8**: `Long` - Deadline Original (Copiado de Config para validación).
- **Registro R9**: `Coll[Byte]` - Config Box ID.

---

## Fase 1: Actualización del Contrato `game_active.es`

**Objetivo**: Modificar las lecturas de registros para usar `CONTEXT.dataInputs` buscando la Config Box por ID almacenado en `R6`.

1.  **Modificar Extracción de Valores**:
    - Obtener `configBoxId` de `SELF.R6`.
    - Buscar `configBox` en `CONTEXT.dataInputs` donde `id == configBoxId`.
    - Leer `secretHash` de `configBox.R7`.
    - Leer `invitedJudges` de `configBox.R4`.
    - Leer `numericalParams` de `configBox.R5`.
    - Leer `gameProvenance` de `configBox.R6`.

2.  **Actualizar `action1_transitionToResolution`**:
    - Validar que `OUTPUTS(0)` (Resolution Box) tenga la nueva estructura:
        - `R9` debe ser `configBoxId` (preservación).
        - `R7` debe ser el deadline calculado (`deadline + PARTICIPATION_TIME_WINDOW` estimado o similar). *Nota: Validar lógica actual vs nueva.*
        - Validar que no se copien listas gigantes de jueces a la nueva caja.

3.  **Actualizar `action2_transitionToCancellation`**:
    - Validar que `OUTPUTS(0)` (Cancellation Box) tenga la nueva estructura:
        - `R9` debe ser `configBoxId`.
        - `R8` debe ser `deadline` (copiado).

4.  **Actualizar `action3_add_randomness`**:
    - Simplificar drásticamente.
    - Solo verificar preservación de `R6` (Config ID), `R4` (State).
    - Verificar actualización de `R5` (Seed).
    - Verificar preservación de NFT y Valor.
    - Eliminar chequeos de R7, R8, R9 antiguos.

## Fase 2: Actualización del Contrato `game_resolution.es`

**Objetivo**: Adaptar la lógica de resolución para leer configuración de Data Inputs y generar cajas ligeras.

1.  **Modificar Extracción de Valores**:
    - Obtener `configBoxId` de `SELF.R9`.
    - Buscar `configBox`.
    - Leer `invitedJudges` (R4), `numericalParams` (R5), `gameProvenance` (R6).
    - Leer valores dinámicos propios: `resolutionDeadline` (SELF.R7), `resolverPK` (SELF.R8).

2.  **Actualizar `action1_includeOmittedParticipation`**:
    - Al recrear `Game Box` (ahora Resolution Box):
        - Asegurar que `R9` sea `configBoxId`.
        - Asegurar que `R7` y `R8` (dinámicos) se mantengan o actualicen según lógica.
        - No escribir jueces ni params estáticos en output.

3.  **Actualizar Lógica de Jueces (`judgeInvalidationLogic`)**:
    - Validar votos contra `invitedJudges` leído de Config Box.
    - Recrear caja ligera.

4.  **Actualizar `action4_endGame`**:
    - Verificar transición a `end_game`. Asegurar que la caja de `end_game` reciba lo necesario (posiblemente referenciando Config Box también si necesita esos datos para distribución, o copiando datos mínimos). *Revisar contrato `end_game.es` si es necesario.*

## Fase 3: Actualización del Contrato `game_cancellation.es`

**Objetivo**: Adaptar validación de cancelación.

1.  **Modificar Extracción**:
    - Leer Config Box desde ID en `R9`.
    - Obtener parámetros necesarios para validar tiempos y valores.

## Fase 4: Actualización del Contrato `end_game.es`

**Objetivo**: Adaptar la lógica de finalización para leer configuración de Data Inputs, ya que la caja de resolución ya no contiene los datos estáticos.

1.  **Modificar Extracción de Valores**:
    - Obtener `configBoxId` de `SELF.R9`.
    - Buscar `configBox` en `CONTEXT.dataInputs`.
    - Leer `participatingJudges` (R4), `numericalParams` (R5), `gameProvenance` (R6) de la Config Box.
    - Leer `resolverPK` de `SELF.R8`.
    - Leer `resolutionDeadline` de `SELF.R7` (si es necesario para la lógica de auth grace period).

2.  **Validación de Pagos**:
    - Asegurar que los cálculos de comisiones usen los valores leídos de la Config Box.

## Fase 5: Actualización de Contratos de Participación

### `participation.es`
1.  **Acceso a Datos del Juego**:
    - Si el script lee la caja del juego (ej. para verificar `deadline` en `action2_claim_grace_period`):
        - Leer `gameBox` (Input/DataInput).
        - Obtener `configBoxId` de `gameBox` (R6 en Active, R9 en Resolution).
        - Buscar `configBox` en Data Inputs para leer el `deadline` real.

### `participation_batch.es`
1.  **Validación de Batch**:
    - Incluir Config Box como Data Input para leer `participationTokenId` y comisiones si es necesario validar pagos/fees.

IMPORTANTE: Realizar la menor cantidad de cambios posibles.