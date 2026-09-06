const { chromium } = require('playwright');

const URL =
  'https://sede.administracionespublicas.gob.es/icpplustiej/icpplus/citar?locale=es';

// Provincias que quieres vigilar
const PROVINCIAS = [
  'Madrid',
  'Barcelona',
  'Valencia',
  'Salamanca',
  'Badajoz',
  'Cádiz',
  'Bizkaia',
];

// Los buscamos por palabras para que funcione aunque el texto exacto
// cambie ligeramente entre provincias.
const TRAMITES = [
  {
    nombre: 'TIE / Toma de huellas',
    palabras: [
      'TOMA DE HUELLAS',
      'TOMA DE HUELLA',
      'EXPEDICIÓN DE TARJETA',
    ],
  },
  {
    nombre: 'Recogida TIE',
    palabras: [
      'RECOGIDA',
      'TARJETA DE IDENTIDAD DE EXTRANJERO',
      'TIE',
    ],
  },
  {
    nombre: 'Asilo',
    palabras: [
      'ASILO',
      'SOLICITUD DE ASILO',
      'SOLICITANTES DE ASILO',
    ],
  },
  {
    nombre: 'Autorización de regreso',
    palabras: [
      'AUTORIZACIÓN DE REGRESO',
      'AUTORIZACION DE REGRESO',
    ],
  },
];

// Frases habituales cuando no existen citas.
const SIN_CITA = [
  'NO HAY CITAS DISPONIBLES',
  'NO EXISTEN CITAS DISPONIBLES',
  'NO HAY CITA DISPONIBLE',
  'NO EXISTE CITA DISPONIBLE',
  'EN ESTE MOMENTO NO HAY CITAS',
  'NO HAY DISPONIBILIDAD',
];

function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function coincide(texto, palabras) {
  const t = normalizar(texto);

  return palabras.some((palabra) => {
    return t.includes(normalizar(palabra));
  });
}

async function obtenerSelects(page) {
  return await page.locator('select').evaluateAll((selects) => {
    return selects.map((select, index) => ({
      index,
      name: select.getAttribute('name'),
      id: select.id,
      opciones: Array.from(select.options).map((option) => ({
        texto: option.textContent.trim(),
        value: option.value,
      })),
    }));
  });
}

async function buscarSelectProvincia(page) {
  const selects = await obtenerSelects(page);

  return selects.find((select) =>
    PROVINCIAS.some((provincia) =>
      select.opciones.some(
        (opcion) =>
          normalizar(opcion.texto) === normalizar(provincia)
      )
    )
  );
}

async function seleccionarProvincia(page, provincia) {
  const datos = await buscarSelectProvincia(page);

  if (!datos) {
    throw new Error(
      'No se encontró el selector de provincias. ' +
      'El portal puede haber cambiado su estructura.'
    );
  }

  const selector = page.locator('select').nth(datos.index);

  const opcion = datos.opciones.find(
    (op) => normalizar(op.texto) === normalizar(provincia)
  );

  if (!opcion) {
    return false;
  }

  console.log(`\n📍 Provincia: ${provincia}`);

  await selector.selectOption(opcion.value);

  // Esperamos a que el portal actualice los trámites.
  await page.waitForTimeout(2500);

  return true;
}

async function obtenerTramitesDisponibles(page) {
  const selects = await obtenerSelects(page);

  const candidatos = selects
    .filter((select) => select.opciones.length > 1)
    .sort((a, b) => b.opciones.length - a.opciones.length);

  const encontrados = [];

  for (const tramite of TRAMITES) {
    for (const select of candidatos) {
      const opcion = select.opciones.find((op) =>
        coincide(op.texto, tramite.palabras)
      );

      if (opcion) {
        encontrados.push({
          ...tramite,
          selectIndex: select.index,
          value: opcion.value,
          textoReal: opcion.texto,
        });

        break;
      }
    }
  }

  return encontrados;
}

async function comprobarDisponibilidad(page, provincia, tramite) {
  const selector = page.locator('select').nth(tramite.selectIndex);

  console.log(`   🔎 ${tramite.nombre}`);
  console.log(`      → ${tramite.textoReal}`);

  try {
    await selector.selectOption(tramite.value);

    await page.waitForTimeout(2000);

    const texto = normalizar(
      await page.locator('body').innerText()
    );

    const noHayCita = SIN_CITA.some((frase) =>
      texto.includes(normalizar(frase))
    );

    if (noHayCita) {
      console.log('      ❌ Sin citas');
      return false;
    }

    // Buscamos indicios de que el portal permite continuar.
    const indicios = [
      'SOLICITAR CITA',
      'INTRODUZCA LOS DATOS',
      'DATOS DEL SOLICITANTE',
      'ACEPTAR',
      'SIGUIENTE',
      'SELECCIONAR OFICINA',
    ];

    const hayIndicio = indicios.some((frase) =>
      texto.includes(normalizar(frase))
    );

    if (hayIndicio) {
      console.log('      ✅ POSIBLE DISPONIBILIDAD');
      console.log('      ⚠️ Revisa la página manualmente.');
      return true;
    }

    console.log('      ⚠️ Estado no determinado');
    return false;
  } catch (error) {
    console.log(`      ⚠️ No se pudo comprobar: ${error.message}`);
    return false;
  }
}

async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ejecutar() {
  console.log('==========================================');
  console.log(' MONITOR DE CITAS DE EXTRANJERÍA');
  console.log('==========================================');
  console.log(`Provincias: ${PROVINCIAS.length}`);
  console.log(`Trámites: ${TRAMITES.length}`);
  console.log('');

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    locale: 'es-ES',
  });

  const page = await context.newPage();

  try {
    console.log('🌐 Abriendo portal oficial...');

    await page.goto(URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log('✅ Portal abierto.');

    // Mostramos los selectores encontrados para poder diagnosticar
    // cambios en la web.
    const selectsIniciales = await obtenerSelects(page);

    console.log(
      `📋 Selectores encontrados: ${selectsIniciales.length}`
    );

    for (const provincia of PROVINCIAS) {
      try {
        const seleccionada = await seleccionarProvincia(
          page,
          provincia
        );

        if (!seleccionada) {
          console.log(`   ⚠️ ${provincia} no aparece.`);
          continue;
        }

        const tramitesDisponibles =
          await obtenerTramitesDisponibles(page);

        if (tramitesDisponibles.length === 0) {
          console.log(
            '   ⚠️ No se encontraron los trámites configurados.'
          );

          continue;
        }

        console.log(
          `   📋 Trámites encontrados: ${tramitesDisponibles.length}`
        );

        for (const tramite of tramitesDisponibles) {
          await comprobarDisponibilidad(
            page,
            provincia,
            tramite
          );
        }
      } catch (error) {
        console.log(
          `   ❌ Error en ${provincia}: ${error.message}`
        );
      }

      // Pequeña pausa para no hacer peticiones continuamente.
      await esperar(1500);
    }

    console.log('\n==========================================');
    console.log(' FIN DE LA COMPROBACIÓN');
    console.log('==========================================');
    console.log(
      'La ventana permanecerá abierta 30 segundos para revisar el resultado.'
    );

    await esperar(30000);
  } catch (error) {
    console.error('\n❌ ERROR GENERAL:');
    console.error(error);
  } finally {
    await browser.close();
  }
}

ejecutar();
