# Fixture: pendientes y ya jugados

Se agregó un selector dentro de Fixture para alternar entre:

- Pendientes
- Ya jugados

## Comportamiento

- Los partidos con `status: "played"` dejan de aparecer en la vista principal de pendientes.
- Los partidos jugados aparecen en la vista "Ya jugados".
- Se mantienen las fases: fase de grupos, dieciseisavos, octavos, cuartos, semifinales, tercer puesto y final.
- En cada fase se muestra un aviso si no hay partidos para esa vista.
- No se modifican resultados, predicciones, ranking, login ni reglas de Firebase.
