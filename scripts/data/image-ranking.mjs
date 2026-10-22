const CAT_GOOD = /quality images|featured pictures|valued images|^(streets|squares|parks|buildings|street views|lakes|rivers|canals|residential buildings|houses|villages|cityscapes|views|bridges|churches|castles|palaces|gardens|promenades|shorelines) |street view|cityscape|views of /i;
const CAT_BAD = /interior|maps|drawings|prints|engravings|historical|historic images|old |aerial|night|signs|plaques|memorial|monuments? |sculptures|statues|details|vehicles|trains|buses|trams|people|events|demonstrations|stolpersteine|cemeter|graves|portraits|museum|exhibitions|logos|diagrams|posters|advertis|animals|plants|flowers|food|graffiti|tunnels|platforms|construction|ruins|u-bahn|s-bahn|railway/i;

/** Lower is better: nearby article, quality and street-view images win; odd subjects lose. */
export function imageRank(name, distance, categories, articleImages) {
  const articleIndex = articleImages.indexOf(name);
  return (articleIndex >= 0 ? -30 + articleIndex * 1.5 : 0)
    + distance / 60
    - 25 * categories.filter((category) => CAT_GOOD.test(category)).length
    + 30 * categories.filter((category) => CAT_BAD.test(category)).length;
}
