import './Landing.css';
import getrandomFact from './landingAPI';
import React, {useEffect, useState} from 'react';

const LandingPage = () => {
    const [fact, setFact] = useState('Loading Science Facts..');

    useEffect(() => {
        const today = new Date().toISOString().split('T')[0]; // e.g., "2025-06-23"
        const savedDate = localStorage.getItem('factDate');
        const savedFact = localStorage.getItem('fact');

        if (savedDate === today && savedFact) {
            setFact(savedFact);
        } else {
            getrandomFact().then(f => {
            setFact(f);
            localStorage.setItem('fact', f);
            localStorage.setItem('factDate', today);
            }).catch(() => {
            setFact('Sorry, no fact today.');
            });
        }
    }, []);

    
    return (
        <>
        <div className ="Title_Box">
            {/* three bar logo for menu lives here */}
            <div className="nav-bar">
                <nav>
                    <ul>
                        <li>Home</li>
                        <li>Back</li>
                        <li>Contact</li>
                    </ul>
                </nav>
            </div>

            <div className="wesbiteName">
                <h2>MolLookUp</h2>
            </div>

            {/* user icon lives here */}
            <div className="UserLogin">
                <h3>UserLogin</h3>
            </div>
        </div>

        <div className="fact-Container">
            <div className="Random-Mol-fact">
                <p>{fact}</p>
            </div>
            <div className="Mol-History">
                <p>part</p>    
            </div>
        </div>

        {/* input the search */}
        <div className="Search-Container">
            <form>
                <label for ="input">
                    <p className="inputText" >
                        Find chemical compounds, see 3D models, and explore molecular data.
                    </p>
                </label>
                <center>
                    <input type="text" id="input" name="search" placeholder='Enter molecule name here'></input>
                </center> 
           </form>
        </div>

        <div className="description-field area" ></div>

        <div className="footer-Area">
            <footer></footer>
        </div>
    </>

    )
}

export default LandingPage;