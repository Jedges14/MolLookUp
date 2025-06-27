export default async function PubChem(name) {
    let encode = encodeURIComponent(name);
    const url =` https://en.wikipedia.org/api/rest_v1/page/summary/${encode}`

    try{
        const response = await fetch(url);
        if (!response.ok){
            if (response.status === 400){
                throw new Error ('Data not Found');
            }
            else if (response.status === 500){
                throw new Error ('Server error');
            }
            else{
                throw new Error ('Sorry molecule not found..');

            }
        };
        const data = await response.json();
        return data;
    }
    catch(error){
        throw new Error(error.message);
    }
}
