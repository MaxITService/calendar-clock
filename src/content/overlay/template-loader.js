// Loads packaged overlay HTML templates for content-script UI rendering.
const calendarClockTemplateCache = new Map();

async function getCalendarClockTemplate(templatePath) {
  if (calendarClockTemplateCache.has(templatePath)) {
    return calendarClockTemplateCache.get(templatePath);
  }

  const templatePromise = (async () => {
    const response = await fetch(chrome.runtime.getURL(templatePath));
    if (!response.ok) {
      throw new Error(`Template load failed (${response.status}): ${templatePath}`);
    }

    const template = document.createElement("template");
    template.innerHTML = (await response.text()).trim();
    return template;
  })().catch(error => {
    calendarClockTemplateCache.delete(templatePath);
    throw error;
  });

  calendarClockTemplateCache.set(templatePath, templatePromise);
  return templatePromise;
}

async function cloneCalendarClockTemplate(templatePath) {
  const template = await getCalendarClockTemplate(templatePath);
  return template.content.cloneNode(true);
}
