/** Zonas horarias frecuentes para elegir en Configuración, con su nombre visible. */
export const ZONAS: Record<string, string> = {
  'America/Lima': 'Lima (Perú)',
  'America/Bogota': 'Bogotá (Colombia)',
  'America/Guayaquil': 'Guayaquil (Ecuador)',
  'America/La_Paz': 'La Paz (Bolivia)',
  'America/Santiago': 'Santiago (Chile)',
  'America/Argentina/Buenos_Aires': 'Buenos Aires (Argentina)',
  'America/Montevideo': 'Montevideo (Uruguay)',
  'America/Asuncion': 'Asunción (Paraguay)',
  'America/Caracas': 'Caracas (Venezuela)',
  'America/Panama': 'Panamá',
  'America/Costa_Rica': 'San José (Costa Rica)',
  'America/Mexico_City': 'Ciudad de México',
  'America/New_York': 'Nueva York (EE. UU.)',
  'Europe/Madrid': 'Madrid (España)',
};

/** "Lima (Perú)" o el identificador IANA si no está en la lista. */
export const nombreZona = (zona: string) => ZONAS[zona] ?? zona;
