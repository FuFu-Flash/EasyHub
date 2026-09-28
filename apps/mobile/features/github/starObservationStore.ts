import { File, Paths } from 'expo-file-system';
import { parseObservations, type StarObservations } from './starObservations';

function observationsFile(login: string): File { return new File(Paths.document, `easyhub-star-observations-${login}.json`); }

export async function loadStarObservations(login: string): Promise<StarObservations> {
  const file = observationsFile(login);
  return file.exists ? parseObservations(await file.text()) : {};
}

export async function saveStarObservations(login: string, observations: StarObservations): Promise<void> {
  const file = observationsFile(login);
  if (!file.exists) file.create();
  file.write(JSON.stringify(observations));
}
