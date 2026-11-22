// Cuentas de Cuadre (Supabase). Las llena el docente con los datos de SU proyecto: Supabase → Project Settings → API.
// supabaseAnon es la clave pública «anon / publishable» (está hecha para ir en la app). NUNCA poner aquí la clave secreta del servidor (la «service»).
// Vacío = Cuadre funciona sin cuentas y la portada dice que llegan pronto.
window.CUADRE_CONFIG = window.CUADRE_CONFIG || {
  supabaseUrl: 'https://oawuflooqalrbypmywpc.supabase.co', // proyecto «cuadre» en Supabase
  supabaseAnon: 'sb_publishable_5zgLV9c9xa3Rj0T39GfjXg__Ilf6qsV', // clave pública (publishable): segura en la app gracias a la RLS
};
