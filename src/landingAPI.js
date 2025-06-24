async function getrandomFact() {
    const url = 'https://facts-by-api-ninjas.p.rapidapi.com/v1/facts';
    const options = {
        method: 'GET',
        headers: {
            'x-rapidapi-key': 'a264a5f280msh004559cbb3a2aadp1ffd52jsn9ccd79e643b8',
		    'x-rapidapi-host': 'facts-by-api-ninjas.p.rapidapi.com'        }
    };

    try {
        const response = await fetch(url, options);
        const result = await response.json();
        return result[0].fact || 'No fact today, dear Newton';
    } catch (error) {
        return 'No science fact, today..', error;
    }
}


export default getrandomFact;



